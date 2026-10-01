import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ACTIONABLE_BADGES_QUERY_KEY } from "@/hooks/useActionableBadges";
import { useInputDialog } from "@/hooks/useInputDialog";
import { authFetch } from "@/lib/auth-fetch";
import { canManageSystemFeatures, canManageTimePayroll } from "@/lib/permissions";
import { formatDailyWage } from "@/lib/time-tracking/format";
import { parseDailyWageInput } from "@/lib/time-tracking/wage";
import type { Location, Profile } from "@/types";
import { countWorkItemsForUsers, filterTimeTrackingEmployees, hasEmployeeWork, resolveEmployeeFilter } from "../employee-list";
import { usePayrollCutoffRefresh } from "../payroll-cutoff-refresh";
import type { WageRecalculationPreview } from "../WageRecalculationDialog";
import type { ApprovalType } from "../contracts";
import { ManagerDialogs } from "./ManagerDialogs";
import { ManagerEmployeeDirectory } from "./ManagerEmployeeDirectory";
import { ManagerHeader } from "./ManagerHeader";
import { TIME_TRACKING_OFFLINE_MESSAGE } from "../policy";

export function ManagerWorkspace({ profile, online, locations, selectedLocationId }: { profile: Profile; online: boolean; locations: Location[]; selectedLocationId?: string }) {
  const queryClient = useQueryClient();
  const { requestInput, inputDialog } = useInputDialog();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const adminLoadRequestIdRef = useRef(0);
  const wageEditTriggerRef = useRef<HTMLButtonElement | null>(null);

  const [viewDashboardUserId, setViewDashboardUserId] = useState<string | null>(null);
  const [viewAuditLogsAdminId, setViewAuditLogsAdminId] = useState<string | null>(null);
  const auditLogsTriggerRef = useRef<HTMLSelectElement>(null);
  const [pendingExpenseApproval, setPendingExpenseApproval] = useState<{
    type: 'TRANSACTION' | 'SLIP';
    adjustment?: boolean;
    id: string;
    title: string;
    amount: number;
    primaryLocationId?: string | null;
    currentLocationId?: string | null;
    refreshOwner?: () => Promise<void>;
  } | null>(null);
  const [pendingPaymentChange, setPendingPaymentChange] = useState<{
    sourceType: 'transaction' | 'payroll_slip';
    sourceId: string;
    paymentAmount: number;
    amountLabel: string;
    primaryLocationId?: string | null;
    currentLocationId?: string | null;
    refreshOwner?: () => Promise<void>;
  } | null>(null);
  const [employeeFilter, setEmployeeFilter] = useState<"pending" | "all" | null>(null);
  const [employeeBranchFilter, setEmployeeBranchFilter] = useState(selectedLocationId ?? "all");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeePageSize, setEmployeePageSize] = useState(10);
  const [employeePage, setEmployeePage] = useState(1);
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const [wagePreviewingUserId, setWagePreviewingUserId] = useState<string | null>(null);
  const [wageCommitBusy, setWageCommitBusy] = useState(false);
  const [wageChangeError, setWageChangeError] = useState<{ userId: string; message: string } | null>(null);
  const [pendingWageChange, setPendingWageChange] = useState<{
    userId: string;
    employeeName: string;
    wageText: string;
    preview: WageRecalculationPreview;
  } | null>(null);
  const [wageDialogOpen, setWageDialogOpen] = useState(false);
  const [wageDialogError, setWageDialogError] = useState<string | null>(null);
  const expenseLocations = useMemo(
    () => data?.paymentLocations ?? locations.filter((location) => location.active),
    [data?.paymentLocations, locations],
  );

  const load = useCallback(async (showLoading = true) => {
    const requestId = ++adminLoadRequestIdRef.current;
    if (showLoading) setLoading(true);
    setLoadError(null);
    try {
      const res = await authFetch("/api/lanflow/time-tracking/admin");
      if (!res.ok) throw new Error("โหลดข้อมูลจัดการเงินเดือนไม่สำเร็จ");
      const json = await res.json();
      if (requestId !== adminLoadRequestIdRef.current) return;
      setData(json);
    } catch (err) {
      if (requestId !== adminLoadRequestIdRef.current) return;
      console.error("Failed to load admin time tracking:", err);
      setLoadError("โหลดข้อมูลจัดการเงินเดือนไม่สำเร็จ");
    } finally {
      if (requestId === adminLoadRequestIdRef.current) setLoading(false);
    }
  }, []);
  const refreshPayrollBoundary = useCallback(async () => {
    await Promise.all([
      load(false),
      queryClient.invalidateQueries({ queryKey: [ACTIONABLE_BADGES_QUERY_KEY] }),
    ]);
  }, [load, queryClient]);

  useEffect(() => {
    void load();
    return () => {
      adminLoadRequestIdRef.current += 1;
    };
  }, [load]);
  useEffect(() => { if (selectedLocationId) { setEmployeeBranchFilter(selectedLocationId); setEmployeePage(1); } }, [selectedLocationId]);
  usePayrollCutoffRefresh(
    refreshPayrollBoundary,
    data?.settings?.workdayEndTime,
    data?.settings?.pendingEffectiveDate,
    data?.users,
  );

  useEffect(() => {
    const refreshVisibleData = () => {
      if (document.visibilityState === "visible") void load(false);
    };
    window.addEventListener("focus", refreshVisibleData);
    document.addEventListener("visibilitychange", refreshVisibleData);
    return () => {
      window.removeEventListener("focus", refreshVisibleData);
      document.removeEventListener("visibilitychange", refreshVisibleData);
    };
  }, [load]);

  const permissions = data?.permissions ?? {};
  const canManage = permissions.canManage ?? canManageTimePayroll(profile);
  const canDecide = permissions.canDecide ?? canManageTimePayroll(profile);
  const canConfigure = permissions.canConfigure ?? canManageTimePayroll(profile);
  const canEditGlobalConfig = permissions.canEditGlobalConfig ?? profile.role === "super_admin";
  const canViewAudit = permissions.canViewAudit ?? canManageSystemFeatures(profile);

  async function updateTimePayrollConfig(workdayEndTime: string) {
    setAttendanceSaving(true);
    try {
      const response = await authFetch("/api/lanflow/time-tracking/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "UPDATE_TIME_PAYROLL_CONFIG", payload: { workday_end_time: workdayEndTime } }),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        alert(json?.error || "บันทึกการตั้งค่าไม่สำเร็จ");
        return false;
      }
      await refreshPayrollBoundary();
      return true;
    } catch (error) {
      console.error(error);
      return false;
    } finally {
      setAttendanceSaving(false);
    }
  }

  async function submitApproval(
    type: ApprovalType,
    id: string,
    status: 'APPROVED' | 'REJECTED',
    expenseLocationId?: string | null,
    providedComment?: string,
    refreshOwner?: () => Promise<void>,
    adjustment = false,
  ) {
    if (!online) {
      alert(TIME_TRACKING_OFFLINE_MESSAGE);
      return false;
    }
    const requestedComment = providedComment === undefined
      ? await requestInput({
          title: status === 'APPROVED' ? "อนุมัติรายการ" : "ปฏิเสธรายการ",
          label: status === 'APPROVED' ? "เหตุผลการอนุมัติ" : "เหตุผลการปฏิเสธ",
          multiline: true,
        })
      : providedComment;
    if (requestedComment === null) return false;
    const comment = requestedComment;
    const failureMessage = status === 'APPROVED'
      ? 'ไม่สามารถบันทึกการอนุมัติได้'
      : 'ไม่สามารถบันทึกการปฏิเสธได้';
    let res: Response;
    try {
      res = await authFetch("/api/lanflow/time-tracking/admin", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: adjustment
            ? 'DECIDE_WITHDRAWAL_ADJUSTMENT'
            : type === 'TRANSACTION' ? 'APPROVE_TRANSACTION' : 'APPROVE_PAYROLL_SLIP',
          payload: adjustment
            ? { adjustment_id: id, status, admin_comment: comment, expense_location_id: expenseLocationId }
            : type === 'TRANSACTION'
            ? { transaction_id: id, status, admin_comment: comment, expense_location_id: expenseLocationId }
            : { slip_id: id, status, admin_comment: comment, expense_location_id: expenseLocationId }
        })
      });
    } catch (error) {
      console.error("Failed to submit time/payroll decision:", error);
      if (providedComment !== undefined) throw new Error(failureMessage);
      alert(failureMessage);
      return false;
    }
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      if (providedComment !== undefined) throw new Error(json?.error || failureMessage);
      alert(json?.error || failureMessage);
      return false;
    }
    await Promise.all([
      load(false),
      refreshOwner?.(),
      queryClient.invalidateQueries({ queryKey: [ACTIONABLE_BADGES_QUERY_KEY] }),
    ]);
    return true;
  }

  function handleApprove(
    type: ApprovalType,
    id: string,
    expense?: { title: string; amount: number; primaryLocationId?: string | null },
    refreshOwner?: () => Promise<void>,
  ) {
    if (expense) {
      setPendingExpenseApproval({ type: type as 'TRANSACTION' | 'SLIP', id, ...expense, refreshOwner });
      return Promise.resolve(false);
    }
    return submitApproval(type, id, 'APPROVED', undefined, undefined, refreshOwner);
  }

  async function submitPaymentChange(locationId: string | null, comment: string) {
    if (!pendingPaymentChange) return false;
    const res = await authFetch("/api/lanflow/time-tracking/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "CHANGE_EXPENSE_LOCATION",
        payload: {
          source_type: pendingPaymentChange.sourceType,
          source_id: pendingPaymentChange.sourceId,
          expense_location_id: locationId,
          admin_comment: comment,
        },
      }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      throw new Error(json?.error || "ไม่สามารถเปลี่ยนวิธีจ่ายได้");
    }
    const refreshOwner = pendingPaymentChange.refreshOwner;
    setPendingPaymentChange(null);
    await Promise.all([load(false), refreshOwner?.()]);
    return true;
  }

  const [payrollUserId, setPayrollUserId] = useState<string | null>(null);

  function openPayroll(user: any) {
    if (!online) {
      alert(TIME_TRACKING_OFFLINE_MESSAGE);
      return;
    }
    setPayrollUserId(user.id);
  }

  function closeAuditLogs() {
    setViewAuditLogsAdminId(null);
    window.requestAnimationFrame(() => auditLogsTriggerRef.current?.focus());
  }

  async function loadWagePreview(userId: string, wageText: string) {
    const response = await authFetch("/api/lanflow/time-tracking/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "PREVIEW_WAGE_RECALCULATION",
        payload: { user_id: userId, daily_wage: wageText },
      }),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) throw new Error(json?.error || "ตรวจผลกระทบของค่าแรงไม่สำเร็จ");
    return json.preview as WageRecalculationPreview;
  }

  async function editWage(userId: string, employeeName: string, currentWage: number) {
    if (!online) {
      alert(TIME_TRACKING_OFFLINE_MESSAGE);
      return;
    }
    const wageText = await requestInput({
      title: "แก้ไขค่าแรงรายวัน",
      label: "ค่าแรงรายวัน (บาท)",
      initialValue: formatDailyWage(currentWage),
      inputType: "number",
      required: true,
      min: 0,
      step: 0.0001,
    });
    if (wageText === null) return;
    if (parseDailyWageInput(wageText) === null) {
      setWageChangeError({ userId, message: "ค่าแรงต้องเป็น 0 ขึ้นไปและมีทศนิยมไม่เกิน 4 ตำแหน่ง" });
      return;
    }

    setWagePreviewingUserId(userId);
    setWageChangeError(null);
    try {
      const normalizedWage = wageText.trim();
      const preview = await loadWagePreview(userId, normalizedWage);
      if (preview.noOp) {
        toast.info("ค่าแรงเท่าเดิม ไม่มีข้อมูลที่ต้องเปลี่ยน");
        return;
      }
      setPendingWageChange({ userId, employeeName, wageText: normalizedWage, preview });
      setWageDialogError(null);
      setWageDialogOpen(true);
    } catch (error) {
      console.error("Failed to preview daily wage:", error);
      setWageChangeError({
        userId,
        message: error instanceof Error ? error.message : "ตรวจผลกระทบของค่าแรงไม่สำเร็จ",
      });
    } finally {
      setWagePreviewingUserId(null);
    }
  }

  async function commitWageChange() {
    if (!pendingWageChange || wageCommitBusy) return;
    setWageCommitBusy(true);
    setWageDialogError(null);
    try {
      const response = await authFetch("/api/lanflow/time-tracking/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "COMMIT_WAGE_RECALCULATION",
          payload: {
            user_id: pendingWageChange.userId,
            daily_wage: pendingWageChange.wageText,
            expected_digest: pendingWageChange.preview.digest,
          },
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        if (json?.code === "WAGE_PREVIEW_STALE") {
          const refreshedPreview = await loadWagePreview(
            pendingWageChange.userId,
            pendingWageChange.wageText,
          );
          if (refreshedPreview.noOp) {
            setWageDialogOpen(false);
            toast.info("ข้อมูลล่าสุดมีค่าแรงตามที่ระบุแล้ว ไม่มีข้อมูลที่ต้องเปลี่ยน");
            return;
          }
          setPendingWageChange((current) => current ? { ...current, preview: refreshedPreview } : current);
          setWageDialogError("ข้อมูลเปลี่ยนระหว่างยืนยัน ระบบโหลด Preview ล่าสุดแล้ว กรุณาตรวจยอดอีกครั้ง");
          return;
        }
        throw new Error(json?.error || "แก้ไขค่าแรงรายวันไม่สำเร็จ");
      }
      setWageChangeError(null);
      setWageDialogOpen(false);
      await Promise.all([
        load(false),
        queryClient.invalidateQueries({ queryKey: [ACTIONABLE_BADGES_QUERY_KEY] }),
      ]);
      toast.success("แก้ค่าแรงและคำนวณยอดหักใหม่แล้ว");
    } catch (error) {
      console.error("Failed to commit daily wage:", error);
      setWageDialogError(error instanceof Error ? error.message : "แก้ไขค่าแรงรายวันไม่สำเร็จ");
    } finally {
      setWageCommitBusy(false);
    }
  }

  if (loading) return <div>กำลังโหลดข้อมูล...</div>;

  if (loadError) return (
    <div role="alert" className="rounded-xl border border-danger/25 bg-danger/5 p-4">
      <p className="text-sm font-semibold text-danger">{loadError}</p>
      <button type="button" onClick={() => void load()} className="focus-ring mt-3 rounded-lg bg-river px-4 py-2 text-sm font-semibold text-white hover:bg-river/90">
        โหลดอีกครั้ง
      </button>
    </div>
  );

  const users = [...(data?.users || [])].sort((left: any, right: any) => {
    if (left.id === profile.id) return -1;
    if (right.id === profile.id) return 1;
    return 0;
  });
  const pendingUserIds = new Set(users.filter((user: any) => hasEmployeeWork(
    user, data?.pendingTransactions, data?.pendingSlips,
  )).map((user: any) => user.id));
  const branchUsers = filterTimeTrackingEmployees(users, pendingUserIds, "", "all", employeeBranchFilter);
  const branchUserIds = new Set(branchUsers.map((user: any) => user.id as string));
  const branchPendingCount = countWorkItemsForUsers(data?.pendingTransactions, data?.pendingSlips, users, branchUserIds);
  const activeEmployeeFilter = resolveEmployeeFilter(employeeFilter, branchPendingCount > 0);
  const filteredUsers = filterTimeTrackingEmployees(
    users,
    pendingUserIds,
    employeeSearch,
    activeEmployeeFilter,
    employeeBranchFilter,
  );
  const branchLocationIds = new Set(users.map((user: any) => user.primary_location_id).filter(Boolean));
  const branchOptions = (data?.paymentLocations || locations)
    .filter((location: Location) => location.active
      && (branchLocationIds.has(location.id) || location.id === selectedLocationId));
  const hasUnassignedUsers = users.some((user: any) => !user.primary_location_id);
  const totalEmployeePages = Math.max(1, Math.ceil(filteredUsers.length / employeePageSize));
  const currentEmployeePage = Math.min(employeePage, totalEmployeePages);
  const visibleUsers = filteredUsers.slice((currentEmployeePage - 1) * employeePageSize, currentEmployeePage * employeePageSize);
  const dashboardUser = users.find((user: any) => user.id === viewDashboardUserId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-6 p-4">
         <ManagerHeader
           settings={data?.settings}
           canEditGlobalConfig={canEditGlobalConfig}
           online={online}
           attendanceSaving={attendanceSaving}
           onSave={updateTimePayrollConfig}
           canViewAudit={canViewAudit}
           admins={data?.admins}
           auditLogsTriggerRef={auditLogsTriggerRef}
           onOpenAudit={setViewAuditLogsAdminId}
         />

       <ManagerEmployeeDirectory
         employeeSearch={employeeSearch}
         setEmployeeSearch={setEmployeeSearch}
         employeeBranchFilter={employeeBranchFilter}
         setEmployeeBranchFilter={setEmployeeBranchFilter}
         setEmployeePage={setEmployeePage}
         branchOptions={branchOptions}
         hasUnassignedUsers={hasUnassignedUsers}
         activeEmployeeFilter={activeEmployeeFilter}
         branchPendingCount={branchPendingCount}
         setEmployeeFilter={setEmployeeFilter}
         employeePageSize={employeePageSize}
         setEmployeePageSize={setEmployeePageSize}
         visibleUsers={visibleUsers}
         profileId={profile.id}
         online={online}
         canConfigure={canConfigure}
         canManage={canManage}
         wagePreviewingUserId={wagePreviewingUserId}
         wageChangeError={wageChangeError}
         pendingTransactions={data?.pendingTransactions}
         pendingSlips={data?.pendingSlips}
         filteredUserCount={filteredUsers.length}
         currentEmployeePage={currentEmployeePage}
         onOpenDashboard={setViewDashboardUserId}
         onEditWage={(user, trigger) => {
           wageEditTriggerRef.current = trigger;
           void editWage(user.id, user.name, user.daily_wage || 0);
         }}
         onOpenPayroll={openPayroll}
       />

      <ManagerDialogs
        profile={profile}
        online={online}
        dashboardUser={dashboardUser}
        viewDashboardUserId={viewDashboardUserId}
        setViewDashboardUserId={setViewDashboardUserId}
        expenseLocations={expenseLocations}
        canManage={canManage}
        canDecide={canDecide}
        canConfigure={canConfigure}
        setPendingExpenseApproval={setPendingExpenseApproval}
        handleApprove={handleApprove}
        submitApproval={submitApproval}
        viewAuditLogsAdminId={viewAuditLogsAdminId}
        adminName={data?.admins?.find((admin: any) => admin.id === viewAuditLogsAdminId)?.name}
        closeAuditLogs={closeAuditLogs}
        payrollUser={users.find((user: any) => user.id === payrollUserId)}
        setPayrollUser={setPayrollUserId}
        setPendingPaymentChange={setPendingPaymentChange}
        load={refreshPayrollBoundary}
        pendingExpenseApproval={pendingExpenseApproval}
        pendingPaymentChange={pendingPaymentChange}
        submitPaymentChange={submitPaymentChange}
        pendingWageChange={pendingWageChange}
        wageDialogOpen={wageDialogOpen}
        wageCommitBusy={wageCommitBusy}
        wageDialogError={wageDialogError}
        setWageDialogOpen={setWageDialogOpen}
        commitWageChange={commitWageChange}
        setPendingWageChange={setPendingWageChange}
        setWageDialogError={setWageDialogError}
        wageEditTriggerRef={wageEditTriggerRef}
      />
      {inputDialog}
      </div>
    </div>
  );
}
