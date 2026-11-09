import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useIncomeExpenseApprovals } from "@/hooks/useIncomeExpenseApprovals";
import { useInputDialog } from "@/hooks/useInputDialog";
import { useLocations } from "@/hooks/useLocations";
import { ModalShell } from "@/components/shared/ModalShell";
import { AlertDialog } from "@/components/shared/AlertDialog";
import { IncomeExpenseApprovalTable } from "./IncomeExpenseApprovalTable";
import { IncomeExpenseApprovalSettings } from "./IncomeExpenseApprovalSettings";

export function IncomeExpenseApprovalModal({
  initialLocationId,
  initialRequestId,
  canEditSettings,
  onClose,
}: {
  initialLocationId: string;
  initialRequestId?: string;
  canEditSettings: boolean;
  onClose: () => void;
}) {
  const { requestInput, inputDialog } = useInputDialog();
  const [requestLocationFilter, setRequestLocationFilter] = useState(initialLocationId);
  const {
    keywords,
    settings,
    requests,
    cashDeleteRequests,
    branchDeleteRequests,
    pendingCount,
    hasRequestLoadError,
    isRefetchingRequests,
    requestsLoading,
    settingsLoading, keywordsLoading, settingsError, keywordsError, retrySettings, retryKeywords,
    addKeyword,
    disableKeyword,
    saveSettings,
    decideRequest,
    decideCashDeleteRequest,
    decideBranchDeleteRequest,
    retryRequestLoads,
  } = useIncomeExpenseApprovals({
    includeRequests: true,
    requestsLocationId: requestLocationFilter === "all"
      ? undefined
      : requestLocationFilter,
  });
  const { locations } = useLocations();

  const [configBusy, setConfigBusy] = useState(false);
  const [decidingIds, setDecidingIds] = useState<Set<string>>(new Set());
  const decidingRef = useRef(new Set<string>());
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const confirmationResolver = useRef<((value: boolean) => void) | null>(null);
  function requestConfirmation(message: string) {
    if (confirmationResolver.current) return Promise.resolve(false);
    return new Promise<boolean>(resolve => { confirmationResolver.current = resolve; setConfirmation(message); });
  }
  function finishConfirmation(value: boolean) {
    setConfirmation(null); confirmationResolver.current?.(value); confirmationResolver.current = null;
  }

  useEffect(() => {
    setRequestLocationFilter(initialLocationId);
  }, [initialLocationId]);

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

  const filteredCashDeleteRequests = useMemo(
    () => requestLocationFilter === "all"
      ? cashDeleteRequests
      : cashDeleteRequests.filter((request) => request.sourceLocationId === requestLocationFilter),
    [cashDeleteRequests, requestLocationFilter],
  );
  const filteredBranchDeleteRequests = useMemo(
    () => requestLocationFilter === "all"
      ? branchDeleteRequests
      : branchDeleteRequests.filter((request) => request.locationId === requestLocationFilter),
    [branchDeleteRequests, requestLocationFilter],
  );

  useEffect(() => {
    if (!initialRequestId) return;
    const row = document.getElementById(`income-expense-approval-request-${initialRequestId}`);
    row?.scrollIntoView({ block: "center" });
    row?.focus();
  }, [filteredBranchDeleteRequests, filteredCashDeleteRequests, filteredRequests, initialRequestId, requestsLoading]);

  async function runDecision(id: string, mutate: () => Promise<unknown>, successMessage: string, fallbackMessage: string) {
    if (decidingRef.current.has(id)) return;
    decidingRef.current.add(id);
    setDecidingIds(new Set(decidingRef.current));
    try {
      await mutate();
      toast.success(successMessage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : fallbackMessage);
    } finally {
      decidingRef.current.delete(id);
      setDecidingIds(new Set(decidingRef.current));
    }
  }

  async function handleApprove(id: string) {
    if (!await requestConfirmation("อนุมัติรายการนี้และย้ายเข้า รับ-จ่าย ใช่ไหม?")) return;
    await runDecision(id, () => decideRequest({ id, decision: "approved" }), "อนุมัติรายการแล้ว", "อนุมัติรายการไม่สำเร็จ");
  }

  async function handleReject(id: string) {
    const comment = await requestInput({
      title: "ปฏิเสธรายการ",
      label: "เหตุผลที่ปฏิเสธ (ไม่บังคับ)",
      multiline: true,
    });
    if (comment === null) return;
    await runDecision(id, () => decideRequest({ id, decision: "rejected", comment }), "ปฏิเสธรายการแล้ว", "ปฏิเสธรายการไม่สำเร็จ");
  }

  async function handleCashDeleteDecision(id: string, decision: "approved" | "rejected") {
    const comment = decision === "approved"
      ? (await requestConfirmation("อนุมัติให้ลบรายการโยกเงินนี้ถาวรใช่ไหม?") ? "" : null)
      : await requestInput({
          title: "ปฏิเสธคำขอลบ",
          label: "เหตุผลที่ปฏิเสธ (ไม่บังคับ)",
          multiline: true,
        });
    if (comment === null) return;
    await runDecision(
      id,
      () => decideCashDeleteRequest({ id, decision, comment }),
      decision === "approved" ? "อนุมัติและลบรายการแล้ว" : "ปฏิเสธคำขอลบแล้ว",
      "ดำเนินการคำขอลบไม่สำเร็จ",
    );
  }

  async function handleBranchDeleteDecision(id: string, decision: "approved" | "rejected") {
    const comment = decision === "approved"
      ? (await requestConfirmation("อนุมัติให้ลบรายการโอนเข้าบัญชีสาขานี้ใช่ไหม?") ? "" : null)
      : await requestInput({ title: "ปฏิเสธคำขอลบ", label: "เหตุผลที่ปฏิเสธ (ไม่บังคับ)", multiline: true });
    if (comment === null) return;
    await runDecision(
      id,
      () => decideBranchDeleteRequest({ id, decision, comment }),
      decision === "approved" ? "อนุมัติและลบรายการแล้ว" : "ปฏิเสธคำขอลบแล้ว",
      "ดำเนินการคำขอลบไม่สำเร็จ",
    );
  }

  return (
    <ModalShell title="ตั้งค่าและอนุมัติรับ-จ่าย" subtitle={pendingCount === undefined
      ? "ยังไม่มีผลนับคำขอรออนุมัติ" : `คำขอรออนุมัติ ${pendingCount} รายการ`}
      onClose={onClose} closeDisabled={configBusy || decidingIds.size > 0} size="wide" mobileFullScreen nativeModal>
      <div className="grid min-w-0 gap-5">
        <section aria-label="คำขออนุมัติรับ-จ่าย" className="min-w-0 rounded-xl border border-black/10 bg-field/20 p-2 sm:p-5">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div><h3 className="text-balance font-bold text-ink">คำขออนุมัติรับ-จ่าย</h3><p className="mt-1 text-pretty text-sm text-ink/60">ตรวจสอบรายละเอียดก่อนอนุมัติหรือปฏิเสธ</p></div>
            <label className="grid w-full gap-1.5 text-sm font-semibold text-ink sm:w-64">สาขา
              <select value={requestLocationFilter} onChange={event => setRequestLocationFilter(event.target.value)} className="focus-ring h-11 min-w-0 rounded-lg border border-black/15 bg-white px-3">
                <option value="all">ทุกสาขา</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </label>
          </div>
          {hasRequestLoadError && <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-clay/25 bg-clay/5 p-3 text-sm text-clay">
            <span>โหลดคำขออนุมัติไม่สำเร็จ รายการที่แสดงอาจไม่ครบ</span>
            <button type="button" disabled={isRefetchingRequests} onClick={() => void retryRequestLoads()} className="focus-ring min-h-11 rounded-lg border border-clay/30 bg-white px-3 font-semibold disabled:opacity-50">ลองใหม่</button>
          </div>}
          {requestsLoading ? <p role="status" className="py-6 text-center text-sm text-ink/55">กำลังโหลดคำขอ…</p>
            : filteredRequests.length + filteredCashDeleteRequests.length + filteredBranchDeleteRequests.length === 0
              ? <p className="py-6 text-center text-sm text-ink/55">{hasRequestLoadError ? "ไม่สามารถแสดงคำขออนุมัติได้" : "ยังไม่มีคำขออนุมัติ"}</p>
              : <IncomeExpenseApprovalTable requests={filteredRequests} cashRequests={filteredCashDeleteRequests} branchRequests={filteredBranchDeleteRequests}
                locationNames={locationNameById} decidingIds={decidingIds}
                onDecision={(id, decision) => void (decision === "approved" ? handleApprove(id) : handleReject(id))}
                onCashDecision={(id, decision) => void handleCashDeleteDecision(id, decision)} onBranchDecision={(id, decision) => void handleBranchDeleteDecision(id, decision)} />}
        </section>
        <IncomeExpenseApprovalSettings settings={settings} keywords={keywords} canEdit={canEditSettings}
          settingsLoading={settingsLoading} keywordsLoading={keywordsLoading} settingsError={settingsError} keywordsError={keywordsError}
          save={saveSettings} add={addKeyword} disable={disableKeyword} retrySettings={retrySettings} retryKeywords={retryKeywords} onBusyChange={setConfigBusy} />
      </div>
      {inputDialog}
      <AlertDialog open={confirmation !== null} title="ยืนยันดำเนินการ" description={confirmation ?? ""} confirmLabel="ยืนยัน" onConfirm={() => finishConfirmation(true)} onCancel={() => finishConfirmation(false)} />
    </ModalShell>
  );
}
