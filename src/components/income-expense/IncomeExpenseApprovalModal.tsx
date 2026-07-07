import { Check, Plus, Power, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { formatCurrency } from "@/lib/format";
import { useIncomeExpenseApprovals } from "@/hooks/useIncomeExpenseApprovals";
import { useLocations } from "@/hooks/useLocations";
import { ModalShell } from "@/components/shared/ModalShell";

import type {
  IncomeExpenseApprovalAppliesTo,
  IncomeExpenseApprovalMatchMode,
  IncomeExpenseApprovalReason,
  IncomeExpenseApprovalStatus,
} from "@/types";

const appliesToLabels: Record<IncomeExpenseApprovalAppliesTo, string> = {
  income: "รายรับ",
  expense: "รายจ่าย",
  both: "รับ-จ่าย",
};

const matchModeLabels: Record<IncomeExpenseApprovalMatchMode, string> = {
  contains: "พบข้อความ",
  exact: "ตรงทั้งรายการ",
};

const reasonLabels: Record<IncomeExpenseApprovalReason, string> = {
  keyword: "ข้อความที่กำหนด",
  amount_threshold: "ยอดถึงเกณฑ์",
  keyword_and_amount: "ข้อความและยอดถึงเกณฑ์",
};

const statusLabels: Record<IncomeExpenseApprovalStatus, string> = {
  pending: "รออนุมัติ",
  approved: "อนุมัติแล้ว",
  rejected: "ปฏิเสธแล้ว",
  cancelled: "ยกเลิกแล้ว",
};

function parseOptionalAmount(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const amount = Number(trimmed);
  return Number.isFinite(amount) ? amount : Number.NaN;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function IncomeExpenseApprovalModal({ onClose }: { onClose: () => void }) {
  const {
    keywords,
    settings,
    requests,
    isLoading,
    addKeyword,
    disableKeyword,
    saveSettings,
    decideRequest,
  } = useIncomeExpenseApprovals({ includeRequests: true });
  const { locations } = useLocations();

  const [keyword, setKeyword] = useState("");
  const [keywordAppliesTo, setKeywordAppliesTo] = useState<IncomeExpenseApprovalAppliesTo>("expense");
  const [matchMode, setMatchMode] = useState<IncomeExpenseApprovalMatchMode>("contains");
  const [keywordMinAmount, setKeywordMinAmount] = useState("");
  const [settingsAppliesTo, setSettingsAppliesTo] = useState<IncomeExpenseApprovalAppliesTo>("both");
  const [settingsMinAmount, setSettingsMinAmount] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [requestLocationFilter, setRequestLocationFilter] = useState("all");

  useEffect(() => {
    if (!settings) return;
    setSettingsAppliesTo(settings.appliesTo);
    setSettingsMinAmount(settings.approvalMinAmount != null ? String(settings.approvalMinAmount) : "");
  }, [settings]);

  const locationNameById = useMemo(
    () => new Map(locations.map((location) => [location.id, location.name])),
    [locations]
  );

  const filteredRequests = useMemo(
    () => requestLocationFilter === "all"
      ? requests
      : requests.filter((request) => request.locationId === requestLocationFilter),
    [requestLocationFilter, requests]
  );

  const pendingCount = useMemo(
    () => filteredRequests.filter((request) => request.requestStatus === "pending").length,
    [filteredRequests]
  );

  async function handleSaveSettings(event: React.FormEvent) {
    event.preventDefault();
    const approvalMinAmount = parseOptionalAmount(settingsMinAmount);

    if (Number.isNaN(approvalMinAmount)) {
      toast.error("กรุณากรอกยอดขั้นต่ำเป็นตัวเลข");
      return;
    }

    try {
      setIsSavingSettings(true);
      await saveSettings({
        appliesTo: settingsAppliesTo,
        approvalMinAmount,
      });
      toast.success("บันทึกการตั้งค่าอนุมัติแล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "บันทึกการตั้งค่าไม่สำเร็จ");
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleAddKeyword(event: React.FormEvent) {
    event.preventDefault();
    const normalizedKeyword = keyword.trim();
    const approvalMinAmount = parseOptionalAmount(keywordMinAmount);

    if (!normalizedKeyword) {
      toast.error("กรุณากรอกข้อความที่ต้องตรวจสอบ");
      return;
    }

    if (Number.isNaN(approvalMinAmount)) {
      toast.error("กรุณากรอกยอดขั้นต่ำเป็นตัวเลข");
      return;
    }

    if (keywords.some((item) => item.isActive && item.keyword.trim().toLowerCase() === normalizedKeyword.toLowerCase())) {
      toast.error("มีข้อความนี้ในรายการตรวจสอบแล้ว");
      return;
    }

    try {
      setIsAdding(true);
      await addKeyword({
        keyword: normalizedKeyword,
        appliesTo: keywordAppliesTo,
        matchMode,
        approvalMinAmount,
      });
      setKeyword("");
      setKeywordMinAmount("");
      toast.success("เพิ่มข้อความตรวจสอบแล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "เพิ่มข้อความตรวจสอบไม่สำเร็จ");
    } finally {
      setIsAdding(false);
    }
  }

  async function handleDisableKeyword(id: string, label: string) {
    if (!window.confirm(`ปิดใช้งาน "${label}" ใช่ไหม?`)) return;

    try {
      await disableKeyword(id);
      toast.success("ปิดใช้งานข้อความตรวจสอบแล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ปิดใช้งานไม่สำเร็จ");
    }
  }

  async function handleApprove(id: string) {
    if (!window.confirm("อนุมัติรายการนี้และย้ายเข้า รับ-จ่าย ใช่ไหม?")) return;

    try {
      setDecidingId(id);
      await decideRequest({ id, decision: "approved" });
      toast.success("อนุมัติรายการแล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "อนุมัติรายการไม่สำเร็จ");
    } finally {
      setDecidingId(null);
    }
  }

  async function handleReject(id: string) {
    const comment = window.prompt("เหตุผลที่ปฏิเสธ (ไม่บังคับ)");
    if (comment === null) return;

    try {
      setDecidingId(id);
      await decideRequest({ id, decision: "rejected", comment });
      toast.success("ปฏิเสธรายการแล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ปฏิเสธรายการไม่สำเร็จ");
    } finally {
      setDecidingId(null);
    }
  }

  return (
    <ModalShell
      title="ตั้งค่าและอนุมัติรับ-จ่าย"
      subtitle={`คำขอรออนุมัติ ${pendingCount} รายการ`}
      onClose={onClose}
      size="wide"
    >
      <div className="space-y-5">
        <form onSubmit={handleSaveSettings} className="rounded-md border border-black/10 p-4">
          <div className="mb-3 flex flex-col gap-1">
            <h3 className="font-bold text-ink">เกณฑ์ยอดเงินที่ต้องอนุมัติ</h3>
            <p className="text-sm text-ink/60">เว้นยอดขั้นต่ำว่างไว้เพื่อปิดกฎนี้</p>
          </div>
          <div className="grid gap-3 md:grid-cols-[180px_1fr_auto] md:items-end">
            <label className="grid gap-1 text-sm font-semibold text-ink">
              ใช้กับ
              <select
                value={settingsAppliesTo}
                onChange={(event) => setSettingsAppliesTo(event.target.value as IncomeExpenseApprovalAppliesTo)}
                className="focus-ring h-11 rounded-md border border-black/10 bg-white px-3"
              >
                <option value="both">รับ-จ่าย</option>
                <option value="income">รายรับ</option>
                <option value="expense">รายจ่าย</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold text-ink">
              ยอดขั้นต่ำ
              <input
                type="number"
                min="0"
                step="0.01"
                value={settingsMinAmount}
                onChange={(event) => setSettingsMinAmount(event.target.value)}
                placeholder="เช่น 5000"
                className="focus-ring h-11 rounded-md border border-black/10 px-3"
              />
            </label>
            <button
              type="submit"
              disabled={isSavingSettings}
              className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 font-bold text-white disabled:opacity-50"
            >
              <Check size={18} />
              บันทึก
            </button>
          </div>
        </form>

        <form onSubmit={handleAddKeyword} className="rounded-md border border-black/10 p-4">
          <div className="mb-3 flex flex-col gap-1">
            <h3 className="font-bold text-ink">ข้อความที่ต้องขออนุมัติ</h3>
            <p className="text-sm text-ink/60">ตัวอย่าง: เบิก, ค่าแรง, กับข้าว</p>
          </div>
          <div className="grid gap-3 xl:grid-cols-[1.5fr_150px_170px_1fr_auto] xl:items-end">
            <label className="grid gap-1 text-sm font-semibold text-ink">
              ข้อความ
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="ข้อความที่ต้องตรวจ"
                className="focus-ring h-11 rounded-md border border-black/10 px-3"
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold text-ink">
              ใช้กับ
              <select
                value={keywordAppliesTo}
                onChange={(event) => setKeywordAppliesTo(event.target.value as IncomeExpenseApprovalAppliesTo)}
                className="focus-ring h-11 rounded-md border border-black/10 bg-white px-3"
              >
                <option value="expense">รายจ่าย</option>
                <option value="income">รายรับ</option>
                <option value="both">รับ-จ่าย</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold text-ink">
              วิธีตรวจ
              <select
                value={matchMode}
                onChange={(event) => setMatchMode(event.target.value as IncomeExpenseApprovalMatchMode)}
                className="focus-ring h-11 rounded-md border border-black/10 bg-white px-3"
              >
                <option value="contains">พบข้อความ</option>
                <option value="exact">ตรงทั้งรายการ</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold text-ink">
              ยอดขั้นต่ำเฉพาะข้อความ
              <input
                type="number"
                min="0"
                step="0.01"
                value={keywordMinAmount}
                onChange={(event) => setKeywordMinAmount(event.target.value)}
                placeholder="เว้นว่าง = ทุกยอด"
                className="focus-ring h-11 rounded-md border border-black/10 px-3"
              />
            </label>
            <button
              type="submit"
              disabled={isAdding}
              className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 font-bold text-white disabled:opacity-50"
            >
              <Plus size={18} />
              เพิ่ม
            </button>
          </div>
        </form>

        <section className="rounded-md border border-black/10 p-4">
          <h3 className="mb-3 font-bold text-ink">รายการข้อความตรวจสอบ</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-ink/60">
                  <th className="py-2">ข้อความ</th>
                  <th>ใช้กับ</th>
                  <th>วิธีตรวจ</th>
                  <th>ยอดขั้นต่ำ</th>
                  <th>สถานะ</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {keywords.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-5 text-center text-ink/50">
                      ยังไม่มีข้อความตรวจสอบ
                    </td>
                  </tr>
                ) : (
                  keywords.map((item) => (
                    <tr key={item.id} className={`border-b border-black/5 ${!item.isActive ? "opacity-50" : ""}`}>
                      <td className="py-3 font-semibold text-ink">{item.keyword}</td>
                      <td>{appliesToLabels[item.appliesTo]}</td>
                      <td>{matchModeLabels[item.matchMode]}</td>
                      <td>{item.approvalMinAmount != null ? formatCurrency(item.approvalMinAmount) : "ทุกยอด"}</td>
                      <td>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${item.isActive ? "bg-leaf/10 text-leaf" : "bg-ink/10 text-ink/60"}`}>
                          {item.isActive ? "ใช้งาน" : "ปิดใช้งาน"}
                        </span>
                      </td>
                      <td className="text-right">
                        {item.isActive && (
                          <button
                            type="button"
                            onClick={() => void handleDisableKeyword(item.id, item.keyword)}
                            className="focus-ring inline-flex h-9 items-center gap-2 rounded-md bg-field px-3 font-semibold text-ink"
                          >
                            <Power size={16} />
                            ปิด
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-md border border-black/10 p-4">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h3 className="font-bold text-ink">คำขออนุมัติรับ-จ่าย</h3>
            <label className="grid gap-1 text-sm font-semibold text-ink sm:w-64">
              สาขา
              <select
                value={requestLocationFilter}
                onChange={(event) => setRequestLocationFilter(event.target.value)}
                className="focus-ring h-10 rounded-md border border-black/10 bg-white px-3"
              >
                <option value="all">ทุกสาขา</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-ink/60">
                  <th className="py-2">สถานะ</th>
                  <th>ประเภท</th>
                  <th>สาขา</th>
                  <th>รายการ</th>
                  <th>จำนวนเงิน</th>
                  <th>เหตุผล</th>
                  <th>ผู้ขอ</th>
                  <th>วันที่</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={9} className="py-5 text-center text-ink/50">
                      กำลังโหลด...
                    </td>
                  </tr>
                ) : filteredRequests.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-5 text-center text-ink/50">
                      ยังไม่มีคำขออนุมัติ
                    </td>
                  </tr>
                ) : (
                  filteredRequests.map((request) => (
                    <tr key={request.id} className="border-b border-black/5">
                      <td className="py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                          request.requestStatus === "pending"
                            ? "bg-amber-100 text-amber-700"
                            : request.requestStatus === "approved"
                              ? "bg-leaf/10 text-leaf"
                              : "bg-clay/10 text-clay"
                        }`}>
                          {statusLabels[request.requestStatus]}
                        </span>
                      </td>
                      <td>{request.txType === "income" ? "รายรับ" : "รายจ่าย"}</td>
                      <td>{locationNameById.get(request.locationId) ?? "ไม่ทราบสาขา"}</td>
                      <td>
                        <div className="flex flex-col gap-1">
                          <span className="font-semibold text-ink">{request.title}</span>
                          {request.matchedKeyword && (
                            <span className="text-xs text-ink/55">พบ: {request.matchedKeyword}</span>
                          )}
                        </div>
                      </td>
                      <td className={request.txType === "income" ? "font-semibold text-leaf" : "font-semibold text-clay"}>
                        {formatCurrency(request.cost)}
                      </td>
                      <td>{reasonLabels[request.matchedReason]}</td>
                      <td>{request.requestedByName} · {request.requestedByPhone}</td>
                      <td>{formatDateTime(request.createdAt)}</td>
                      <td className="text-right">
                        {request.requestStatus === "pending" && (
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              disabled={decidingId === request.id}
                              onClick={() => void handleApprove(request.id)}
                              className="focus-ring grid h-9 w-9 place-items-center rounded-md bg-leaf text-white disabled:opacity-50"
                              title="อนุมัติ"
                            >
                              <Check size={16} />
                            </button>
                            <button
                              type="button"
                              disabled={decidingId === request.id}
                              onClick={() => void handleReject(request.id)}
                              className="focus-ring grid h-9 w-9 place-items-center rounded-md bg-clay text-white disabled:opacity-50"
                              title="ปฏิเสธ"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </ModalShell>
  );
}
