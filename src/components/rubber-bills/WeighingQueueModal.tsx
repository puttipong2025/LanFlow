"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Clock3,
  Share2,
  Trash2,
  UserRoundPlus,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ModalShell } from "@/components/shared/ModalShell";
import { SharePdfWaitingModal } from "@/components/shared/SharePdfWaitingModal";
import { useSharePdf } from "@/hooks/useSharePdf";
import { makeClientTempId } from "@/lib/format";
import { receiptPdfFilename } from "@/lib/rubber-bills/print-receipt";
import {
  buildWeighingQueueTicket,
  createEmptyDailyQueue,
  hasQueueItemChangedSinceShare,
  isQueueForCurrentBangkokDay,
  isValidWeighingTime,
  loadCustomerCache,
  loadDailyWeighingQueue,
  markQueueItemShared,
  moveQueueItem,
  removeQueueItem,
  renderWeighingQueueTicketHtml,
  saveDailyWeighingQueue,
  type DailyWeighingQueue,
  type WeighingQueueCustomer,
  type WeighingQueueItem,
} from "@/lib/rubber-bills/weighing-queue";

const SHARED_AT_FORMATTER = new Intl.DateTimeFormat("th-TH-u-ca-buddhist-nu-latn", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function WeighingQueueModal({
  deviceId,
  locationId,
  locationName,
  liveCustomers,
  liveCustomersLoaded,
  onClose,
}: {
  deviceId: string;
  locationId: string;
  locationName: string;
  liveCustomers: WeighingQueueCustomer[];
  liveCustomersLoaded: boolean;
  onClose: () => void;
}) {
  const [queue, setQueue] = useState<DailyWeighingQueue>(() => (
    loadDailyWeighingQueue(deviceId, locationId)
  ));
  const [cachedCustomers, setCachedCustomers] = useState<WeighingQueueCustomer[]>(() => (
    loadCustomerCache(deviceId)
  ));
  const [timeDraft, setTimeDraft] = useState(queue.weighingTime ?? "");
  const [editingTime, setEditingTime] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const pdfShare = useSharePdf();

  useEffect(() => {
    const next = loadDailyWeighingQueue(deviceId, locationId);
    setQueue(next);
    setTimeDraft(next.weighingTime ?? "");
    setEditingTime(false);
    setCachedCustomers(loadCustomerCache(deviceId));
  }, [deviceId, locationId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setQueue((current) => {
        const emptyToday = createEmptyDailyQueue();
        if (current.date === emptyToday.date) return current;
        saveDailyWeighingQueue(deviceId, locationId, emptyToday);
        setTimeDraft("");
        setEditingTime(false);
        return emptyToday;
      });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [deviceId, locationId]);

  const customerOptions = liveCustomers.length > 0 || liveCustomersLoaded
    ? liveCustomers
    : cachedCustomers;
  const usingCustomerCache = !liveCustomersLoaded && liveCustomers.length === 0 && cachedCustomers.length > 0;

  const matchingCustomers = useMemo(() => {
    const search = customerSearch.trim().toLocaleLowerCase("th");
    if (!search) return [];
    return customerOptions
      .filter((customer) => (
        customer.mainName.toLocaleLowerCase("th").includes(search)
        || customer.legacyMemberId?.toLocaleLowerCase("th").includes(search)
      ))
      .slice(0, 8);
  }, [customerOptions, customerSearch]);

  function commitQueue(next: DailyWeighingQueue) {
    try {
      if (!isQueueForCurrentBangkokDay(next)) {
        const emptyToday = createEmptyDailyQueue();
        saveDailyWeighingQueue(deviceId, locationId, emptyToday);
        setQueue(emptyToday);
        setTimeDraft("");
        setEditingTime(false);
        toast.info("เริ่มวันใหม่แล้ว กรุณาตั้งเวลาชั่งอีกครั้ง");
        return false;
      }
      saveDailyWeighingQueue(deviceId, locationId, next);
      setQueue(next);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "บันทึกคิวในเครื่องไม่สำเร็จ");
      return false;
    }
  }

  function saveWeighingTime() {
    if (!isValidWeighingTime(timeDraft)) {
      toast.error("กรุณาระบุเวลาชั่งให้ถูกต้อง");
      return;
    }
    const next = { ...queue, weighingTime: timeDraft };
    if (commitQueue(next)) setEditingTime(false);
  }

  function addCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const customerName = customerSearch.trim();
    if (!queue.weighingTime) {
      toast.error("กรุณาตั้งเวลาชั่งประจำวันก่อน");
      return;
    }
    if (!customerName) {
      toast.error("กรุณาระบุชื่อลูกค้า");
      return;
    }

    const item: WeighingQueueItem = {
      id: makeClientTempId("weigh_queue"),
      customerId: selectedCustomerId,
      customerName,
      createdAt: new Date().toISOString(),
      printSnapshot: null,
    };
    if (commitQueue({ ...queue, items: [...queue.items, item] })) {
      setCustomerSearch("");
      setSelectedCustomerId(null);
      setShowSuggestions(false);
    }
  }

  function moveItem(itemId: string, direction: -1 | 1) {
    const currentIndex = queue.items.findIndex((item) => item.id === itemId);
    const targetItem = queue.items[currentIndex + direction];
    if (currentIndex < 0 || !targetItem) return;
    const items = moveQueueItem(queue.items, itemId, targetItem.id);
    if (items !== queue.items) commitQueue({ ...queue, items });
  }

  function deleteItem(item: WeighingQueueItem, queueNumber: number) {
    if (!window.confirm(`ลบคิว ${queueNumber} — ${item.customerName} ใช่หรือไม่?`)) return;
    commitQueue({ ...queue, items: removeQueueItem(queue.items, item.id) });
  }

  async function shareItem(item: WeighingQueueItem, queueNumber: number) {
    if (!queue.weighingTime || pdfShare.busy) return;
    const sharedAt = new Date();
    const ticket = buildWeighingQueueTicket(item, queueNumber, queue.weighingTime, sharedAt);
    setSharingId(item.id);
    try {
      const delivery = await pdfShare.sharePdf(() => ({
        html: renderWeighingQueueTicketHtml(ticket),
        filename: receiptPdfFilename(
          "LanFlow-weighing-queue",
          `Q${String(queueNumber).padStart(2, "0")}-${ticket.printedDate}-${ticket.weighingTime}`,
        ),
      }));
      if (delivery === "cancelled") return;

      const items = markQueueItemShared(
        queue.items,
        item.id,
        queueNumber,
        queue.weighingTime,
        sharedAt,
      );
      if (!commitQueue({ ...queue, items })) return;
      toast.success(
        delivery === "shared"
          ? "แชร์ PDF บัตรคิวแล้ว"
          : "แชร์บนอุปกรณ์นี้ไม่ได้ จึงดาวน์โหลด PDF แทน",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "สร้าง PDF บัตรคิวไม่สำเร็จ");
    } finally {
      setSharingId(null);
    }
  }

  if (!queue.weighingTime) {
    return (
      <ModalShell
        title="บัตรคิว"
        subtitle={`${locationName} · ตั้งเวลาชั่งร่วมของวันนี้ก่อนเริ่มออกคิว`}
        onClose={onClose}
      >
        <div className="mx-auto max-w-xl py-4">
          <div className="rounded-2xl border border-river/15 bg-gradient-to-br from-river/10 to-white p-6 text-center shadow-sm">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-river text-white shadow-lg shadow-river/20">
              <Clock3 size={28} />
            </span>
            <h3 className="mt-4 text-xl font-black text-ink">กำหนดเวลาชั่งประจำวัน</h3>
            <p className="mt-2 text-sm text-ink/60">
              ลูกค้าทุกคิวของวันนี้จะใช้เวลาชั่งเดียวกัน และแก้ไขภายหลังได้
            </p>
            <label className="mx-auto mt-6 block max-w-xs text-left">
              <span className="mb-2 block text-sm font-bold text-ink">เวลาชั่ง</span>
              <input
                type="time"
                value={timeDraft}
                onChange={(event) => setTimeDraft(event.target.value)}
                className="focus-ring h-14 w-full rounded-xl border border-black/15 bg-white px-4 text-center text-2xl font-black tabular-nums text-ink"
              />
            </label>
            <button
              type="button"
              onClick={saveWeighingTime}
              className="focus-ring mt-5 h-12 w-full max-w-xs rounded-xl bg-river px-5 font-bold text-white shadow-lg shadow-river/20"
            >
              เริ่มคิววันนี้
            </button>
          </div>
        </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell
      title="บัตรคิว"
      subtitle={`${locationName} · คิววันที่ ${queue.date}`}
      size="wide"
      onClose={onClose}
    >
      <div className="space-y-4">
        <section className="flex flex-col gap-4 rounded-2xl bg-gradient-to-r from-river to-cyan-700 p-5 text-white shadow-lg shadow-river/15 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-white/70">เวลาชั่งประจำวัน</p>
            {editingTime ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  type="time"
                  value={timeDraft}
                  onChange={(event) => setTimeDraft(event.target.value)}
                  className="focus-ring h-11 rounded-xl border border-white/30 bg-white px-3 text-lg font-black text-ink"
                />
                <button
                  type="button"
                  onClick={saveWeighingTime}
                  className="focus-ring h-11 rounded-xl bg-commit px-4 font-bold text-white hover:bg-commit/90"
                >
                  บันทึกเวลา
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTimeDraft(queue.weighingTime ?? "");
                    setEditingTime(false);
                  }}
                  className="focus-ring h-11 rounded-xl bg-actionSecondary px-4 font-semibold text-white hover:bg-actionSecondary/90"
                >
                  ยกเลิก
                </button>
              </div>
            ) : (
              <div className="mt-1 flex items-center gap-3">
                <span className="text-4xl font-black tabular-nums">{queue.weighingTime} น.</span>
                <button
                  type="button"
                  onClick={() => setEditingTime(true)}
                  className="focus-ring rounded-xl bg-amber px-3 py-2 text-sm font-bold text-white hover:bg-amber/90"
                >
                  แก้เวลา
                </button>
              </div>
            )}
          </div>
          <div className="rounded-2xl bg-white/12 px-5 py-3 text-center">
            <p className="text-xs font-semibold text-white/70">คิวทั้งหมดวันนี้</p>
            <p className="text-3xl font-black tabular-nums">{queue.items.length}</p>
          </div>
        </section>

        <form
          onSubmit={addCustomer}
          className="rounded-2xl border border-black/10 bg-field/70 p-4"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-black text-ink">เพิ่มลูกค้าเข้าคิว</h3>
              <p className="text-sm text-ink/55">ค้นหาจากทะเบียน หรือพิมพ์ชื่อเองได้</p>
            </div>
            {usingCustomerCache && (
              <span className="rounded-full bg-amber/25 px-3 py-1 text-xs font-bold text-ink">
                ใช้รายชื่อล่าสุดจากเครื่อง
              </span>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <input
                aria-label="ชื่อลูกค้าสำหรับบัตรคิว"
                value={customerSearch}
                onChange={(event) => {
                  setCustomerSearch(event.target.value);
                  setSelectedCustomerId(null);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => window.setTimeout(() => setShowSuggestions(false), 150)}
                autoComplete="off"
                placeholder="ค้นหาชื่อ หรือรหัสสมาชิก..."
                className="focus-ring h-12 w-full rounded-xl border border-black/15 bg-white px-4 text-ink"
              />
              {showSuggestions && matchingCustomers.length > 0 && (
                <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-xl border border-black/10 bg-white shadow-xl">
                  {matchingCustomers.map((customer) => (
                    <button
                      key={customer.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setCustomerSearch(customer.mainName);
                        setSelectedCustomerId(customer.id);
                        setShowSuggestions(false);
                      }}
                      className="flex w-full items-center justify-between gap-3 border-b border-black/5 px-4 py-3 text-left last:border-0 hover:bg-field"
                    >
                      <span className="font-semibold text-ink">{customer.mainName}</span>
                      {customer.legacyMemberId && (
                        <span className="rounded-full bg-leaf/10 px-2 py-0.5 text-xs font-bold text-leaf">
                          {customer.legacyMemberId}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="submit"
              className="focus-ring inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-leaf px-5 font-bold text-white shadow-sm"
            >
              <UserRoundPlus size={19} />
              เพิ่มเข้าคิว
            </button>
          </div>
        </form>

        <section className="overflow-hidden rounded-2xl border border-black/10 bg-white">
          {queue.items.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <UserRoundPlus size={34} className="mx-auto text-ink/25" />
              <p className="mt-3 font-bold text-ink">ยังไม่มีลูกค้าในคิว</p>
              <p className="mt-1 text-sm text-ink/50">เพิ่มชื่อลูกค้าด้านบนเพื่อเริ่มคิวหมายเลข 1</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table aria-label="ตารางคิวชั่ง" className="w-full min-w-[760px] text-sm">
                <thead className="bg-field text-left text-xs font-bold uppercase tracking-wide text-ink/55">
                  <tr>
                    <th className="w-24 px-3 py-3 text-center">ลำดับ</th>
                    <th className="w-20 px-3 py-3 text-center">คิว</th>
                    <th className="px-3 py-3">ชื่อลูกค้า</th>
                    <th className="w-56 px-3 py-3">สถานะ</th>
                    <th className="w-36 px-3 py-3 text-right">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.items.map((item, index) => {
                    const queueNumber = index + 1;
                    const changedAfterShare = hasQueueItemChangedSinceShare(
                      item,
                      queueNumber,
                      queue.weighingTime!,
                    );
                    return (
                      <tr key={item.id} className="border-t border-black/5 transition hover:bg-field/60">
                        <td className="px-3 py-3 text-center">
                          <div className="flex justify-center gap-1">
                            <button
                              type="button"
                              aria-label={`เลื่อนคิว ${queueNumber} ขึ้น`}
                              disabled={index === 0}
                              onClick={() => moveItem(item.id, -1)}
                              className="focus-ring inline-flex h-10 items-center gap-1 rounded-lg bg-actionSecondary px-2 text-xs font-semibold text-white hover:bg-actionSecondary/90 disabled:cursor-not-allowed disabled:opacity-25"
                            >
                              <ArrowUp size={17} />
                              ขึ้น
                            </button>
                            <button
                              type="button"
                              aria-label={`เลื่อนคิว ${queueNumber} ลง`}
                              disabled={index === queue.items.length - 1}
                              onClick={() => moveItem(item.id, 1)}
                              className="focus-ring inline-flex h-10 items-center gap-1 rounded-lg bg-river px-2 text-xs font-semibold text-white hover:bg-river/90 disabled:cursor-not-allowed disabled:opacity-25"
                            >
                              <ArrowDown size={17} />
                              ลง
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className="inline-grid h-10 min-w-10 place-items-center rounded-xl bg-river/10 px-2 text-lg font-black tabular-nums text-river">
                            {queueNumber}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <p className="font-bold text-ink">{item.customerName}</p>
                          {item.customerId && <p className="text-xs text-ink/45">จากทะเบียนลูกค้า</p>}
                        </td>
                        <td className="px-3 py-3">
                          {changedAfterShare ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber/25 px-3 py-1 text-xs font-bold text-ink">
                              <AlertTriangle size={14} />
                              ข้อมูลเปลี่ยนหลังแชร์
                            </span>
                          ) : item.printSnapshot ? (
                            <span className="text-xs font-semibold text-ink/55">
                              แชร์ล่าสุด {SHARED_AT_FORMATTER.format(new Date(item.printSnapshot.printedAt))} น.
                            </span>
                          ) : (
                            <span className="text-xs font-semibold text-ink/40">ยังไม่แชร์</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              aria-label={`แชร์ PDF บัตรคิว ${queueNumber}`}
                              disabled={pdfShare.busy}
                              onClick={() => void shareItem(item, queueNumber)}
                              className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-xl bg-river px-3 font-bold text-white disabled:cursor-wait disabled:opacity-50"
                            >
                              <Share2 size={16} />
                              {sharingId === item.id ? "กำลังสร้าง PDF" : "แชร์ PDF"}
                            </button>
                            <button
                              type="button"
                              aria-label={`ลบคิว ${queueNumber}`}
                              onClick={() => deleteItem(item, queueNumber)}
                              className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-md bg-clay px-3 text-sm font-semibold text-white hover:bg-clay/90"
                            >
                              <Trash2 size={17} />
                              ลบ
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="text-center text-xs text-ink/45">
          ข้อมูลเก็บเฉพาะเครื่องนี้ · วันใหม่จะล้างคิวและต้องตั้งเวลาชั่งอีกครั้ง
        </p>
      </div>
      <SharePdfWaitingModal open={pdfShare.waiting} onCancel={pdfShare.cancel} />
    </ModalShell>
  );
}
