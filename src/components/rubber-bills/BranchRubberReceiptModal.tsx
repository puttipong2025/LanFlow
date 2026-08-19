"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PackagePlus, Search } from "lucide-react";
import { ModalShell } from "@/components/shared/ModalShell";
import { assertApiResponse, authFetch } from "@/lib/auth-fetch";
import { formatBangkokDateTime } from "@/lib/bangkok-date";
import { formatNumber } from "@/lib/format";
import { formatRubberAge } from "@/lib/rubber-exports/rubber-export-presentation";
import type {
  BranchRubberReceiptCandidate,
  BranchRubberReceiptResult,
  RubberBill,
} from "@/types";

function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  return formatBangkokDateTime(new Date(value));
}

export function BranchRubberReceiptModal({
  destinationLocationId,
  destinationLocationName,
  onClose,
  onReceived,
}: {
  destinationLocationId: string;
  destinationLocationName: string;
  onClose: () => void;
  onReceived: (result: BranchRubberReceiptResult) => void | Promise<void>;
}) {
  const [candidates, setCandidates] = useState<BranchRubberReceiptCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const loadController = useRef<AbortController | null>(null);
  const candidatesRef = useRef<BranchRubberReceiptCandidate[]>([]);

  const load = useCallback(async (cursor: string | null = null, append = false) => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ destinationLocationId, search });
      if (cursor) params.set("cursor", cursor);
      const response = await authFetch(
        `/api/lanflow/rubber-bills/branch-receipts?${params.toString()}`,
        { cache: "no-store", signal: controller.signal },
      );
      await assertApiResponse(response);
      const body = await response.json() as {
        candidates: BranchRubberReceiptCandidate[];
        hasMore: boolean;
        nextCursor: string | null;
      };
      if (controller.signal.aborted) return;
      const nextCandidates = append
        ? [...candidatesRef.current, ...body.candidates.filter((row) => !candidatesRef.current.some((item) => item.sourceRubberExportId === row.sourceRubberExportId))]
        : body.candidates;
      candidatesRef.current = nextCandidates;
      setCandidates(nextCandidates);
      setHasMore(body.hasMore);
      setNextCursor(body.nextCursor);
      setSelectedId((current) => (
        nextCandidates.some((candidate) => candidate.sourceRubberExportId === current)
          ? current
          : null
      ));
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "โหลดรายการส่งออกยางไม่สำเร็จ");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [destinationLocationId, search]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    void load();
    return () => loadController.current?.abort();
  // Reload only when the destination or debounced search changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinationLocationId, search]);

  async function receive() {
    if (!selectedId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await authFetch("/api/lanflow/rubber-bills/branch-receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destinationLocationId,
          sourceRubberExportId: selectedId,
        }),
      });
      await assertApiResponse(response);
      const received = await response.json() as BranchRubberReceiptResult;
      const remaining = candidatesRef.current.filter((row) => row.sourceRubberExportId !== selectedId);
      candidatesRef.current = remaining;
      setCandidates(remaining);
      setSelectedId(null);
      await onReceived(received);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "รับยางเข้าสาขาไม่สำเร็จ");
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell
      title="รับยางจากสาขา"
      subtitle={`เลือกหนึ่งรายการเพื่อรับเข้า ${destinationLocationName}`}
      onClose={onClose}
      closeDisabled={submitting}
      size="wide"
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink">ค้นหาเลข REX หรือสาขาต้นทาง</span>
          <span className="flex items-center gap-2 rounded-md border border-black/15 bg-white px-3 focus-within:ring-2 focus-within:ring-river">
            <Search size={17} className="shrink-0 text-ink/50" aria-hidden="true" />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="เช่น REX-001 หรือ สาขาเหนือ"
              className="min-h-10 min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
            />
          </span>
        </label>
        {loading ? (
          <div className="space-y-2" aria-label="กำลังโหลดรายการส่งออกยาง">
            {[1, 2, 3].map((row) => (
              <div key={row} className="h-16 rounded-md bg-slate-100" />
            ))}
          </div>
        ) : candidates.length === 0 ? (
          <div className="rounded-md border border-dashed border-black/20 bg-field p-6 text-center">
            <p className="text-pretty font-semibold text-ink">ยังไม่มีรายการที่พร้อมรับเข้าสาขา</p>
            <button
              type="button"
              onClick={() => void load()}
              className="focus-ring mt-3 rounded-md bg-river px-4 py-2 text-sm font-semibold text-white"
            >
              โหลดรายการอีกครั้ง
            </button>
          </div>
        ) : (
          <div className="max-h-[55vh] overflow-auto rounded-md border border-black/10">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-mint text-left text-ink">
                <tr>
                  <th className="w-12 px-3 py-2 text-center">เลือก</th>
                  <th className="px-3 py-2">สาขาต้นทาง</th>
                  <th className="px-3 py-2">เลข REX</th>
                  <th className="px-3 py-2">เวลาตรวจสอบ</th>
                  <th className="px-3 py-2 text-right">น้ำหนักปัจจุบัน</th>
                  <th className="px-3 py-2 text-right">มูลค่ารวมค่าทำงาน</th>
                  <th className="px-3 py-2 text-right">อายุตอนรับ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/5">
                {candidates.map((candidate) => (
                  <tr key={candidate.sourceRubberExportId}>
                    <td className="px-3 py-3 text-center">
                      <input
                        type="radio"
                        name="branch-rubber-receipt"
                        checked={selectedId === candidate.sourceRubberExportId}
                        onChange={() => setSelectedId(candidate.sourceRubberExportId)}
                        aria-label={`เลือก ${candidate.sourceExportNo} จาก ${candidate.sourceLocationName}`}
                        className="size-4 accent-leaf"
                      />
                    </td>
                    <td className="px-3 py-3 font-semibold">
                      {candidate.sourceLocationName}
                      {candidate.isSameLocation && (
                        <div className="mt-1 w-fit rounded-full bg-amber px-2 py-0.5 text-xs font-semibold text-white">
                          ยางคงเหลือภายในสาขา
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 font-semibold tabular-nums">{candidate.sourceExportNo}</td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums">{dateTime(candidate.verifiedAt)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">{formatNumber(candidate.currentWeight)} กก.</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">฿{formatNumber(candidate.rubberValue)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      {formatRubberAge(candidate.receivedAgeHours)}
                      {candidate.ageIsEstimated && <div className="text-xs font-semibold text-amber-800">ประมาณการ</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && hasMore && nextCursor && (
          <div className="flex flex-col items-center gap-2 rounded-md bg-field px-4 py-3 text-center">
            <p className="text-sm text-ink/65">โหลดแล้ว {candidates.length} รายการ</p>
            <button
              type="button"
              onClick={() => void load(nextCursor, true)}
              className="focus-ring rounded-md bg-river px-4 py-2 text-sm font-semibold text-white"
            >
              โหลดเพิ่ม
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-pretty text-sm font-semibold text-red-700">
            {error}
          </p>
        )}

        <div className="modal-actions flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="focus-ring rounded-md bg-actionSecondary px-4 py-2 font-semibold text-white disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={() => void receive()}
            disabled={!selectedId || loading || submitting}
            className="focus-ring inline-flex items-center gap-2 rounded-md bg-leaf px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PackagePlus size={17} />
            {submitting ? "กำลังรับเข้า..." : "ยืนยันรับเข้าสาขา"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

export function BranchRubberReceiptDetailModal({
  bill,
  onClose,
}: {
  bill: RubberBill;
  onClose: () => void;
}) {
  return (
    <ModalShell
      title={bill.serverBillNo ?? bill.localBillNo}
      subtitle="บิลรับยางจากสาขา · อ่านอย่างเดียว"
      onClose={onClose}
      size="normal"
    >
      <div className="space-y-4">
        <div className="rounded-md bg-mint/60 px-4 py-3">
          <p className="text-balance font-bold text-ink">{bill.customerName}</p>
          <p className="text-pretty text-sm text-ink/60">
            ต้นทาง {bill.sourceExportNo ?? "—"} · รับเมื่อ <span className="tabular-nums">{dateTime(bill.receivedAt)}</span>
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">น้ำหนักปัจจุบัน</div><div className="font-bold tabular-nums">{formatNumber(bill.netWeight)} กก.</div></div>
          <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">มูลค่ารวมค่าทำงาน</div><div className="font-bold tabular-nums">฿{formatNumber(bill.rubberValue)}</div></div>
          <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">อายุตอนรับ</div><div className="font-bold tabular-nums">{formatRubberAge(bill.receivedAgeHours ?? null)}</div>{bill.receivedAgeIsEstimated && <div className="text-xs font-semibold text-amber-800">ประมาณการ</div>}</div>
          <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">ราคาเฉลี่ย</div><div className="font-bold tabular-nums">฿{formatNumber(bill.price)}/กก.</div></div>
          <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">ยอดหักเงิน</div><div className="font-bold tabular-nums">฿{formatNumber(bill.deductionTotal)}</div></div>
          <div className="rounded-md bg-field p-3"><div className="text-xs text-ink/60">ยอดที่ต้องจ่ายลูกค้า</div><div className="font-bold tabular-nums">฿{formatNumber(bill.netTotal)}</div></div>
        </div>
        <div className="rounded-md border border-black/10 p-4">
          <h3 className="text-balance font-bold text-ink">รายการหักเงิน</h3>
          {(bill.debtItems ?? []).map((item) => (
            <div key={item.id} className="mt-2 flex justify-between gap-3 text-sm">
              <span className="text-pretty">{item.title}</span>
              <span className="shrink-0 font-semibold tabular-nums">฿{formatNumber(item.amount)}</span>
            </div>
          ))}
        </div>
      </div>
    </ModalShell>
  );
}
