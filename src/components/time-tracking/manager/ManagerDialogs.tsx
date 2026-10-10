import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { ModalShell } from "@/components/shared/ModalShell";
import { canManageSystemFeatures } from "@/lib/permissions";
import type { Location, Profile } from "@/types";
import { LazyExpenseLocationChangeModal as ExpenseLocationChangeModal } from "../LazyExpenseLocationChangeModal";
import { LazyPaymentAllocationModal as PaymentAllocationModal } from "../LazyPaymentAllocationModal";
import { WageRecalculationDialog, type WageRecalculationPreview } from "../WageRecalculationDialog";
import { AuditLogsModal } from "../audit/AuditLogsModal";
import type { ApprovalType, PaymentAllocationInput } from "../contracts";
import { EmployeeWorkspace } from "../employee/EmployeeWorkspace";
import { PayrollModal } from "../payroll/PayrollModal";

type Approval = {
  type: ApprovalType; id: string; title: string; amount: number; primaryLocationId?: string | null;
  currentLocationId?: string | null; adjustment?: boolean; refreshOwner?: () => Promise<void>;
};
type PaymentChange = {
  sourceType: "transaction" | "payroll_slip"; sourceId: string; paymentAmount: number; amountLabel: string;
  primaryLocationId?: string | null; currentLocationId?: string | null; refreshOwner?: () => Promise<void>;
};
type WageChange = { userId: string; employeeName: string; wageText: string; preview: WageRecalculationPreview };

export function ManagerDialogs({
  profile, online, dashboardUser, viewDashboardUserId, setViewDashboardUserId, expenseLocations,
  canManage, canDecide, canConfigure, setPendingExpenseApproval, handleApprove, submitApproval,
  viewAuditLogsAdminId, adminName, closeAuditLogs, payrollUser, setPayrollUser, setPendingPaymentChange,
  load, pendingExpenseApproval, pendingPaymentChange, submitPaymentChange, pendingWageChange,
  wageDialogOpen, wageCommitBusy, wageDialogError, setWageDialogOpen, commitWageChange,
  setPendingWageChange, setWageDialogError, wageEditTriggerRef,
}: {
  profile: Profile; online: boolean; dashboardUser: any; viewDashboardUserId: string | null;
  setViewDashboardUserId: Dispatch<SetStateAction<string | null>>; expenseLocations: Location[];
  canManage: boolean; canDecide: boolean; canConfigure: boolean; setPendingExpenseApproval: Dispatch<SetStateAction<Approval | null>>;
  handleApprove: (type: ApprovalType, id: string, expense?: { title: string; amount: number; primaryLocationId?: string | null }, refreshOwner?: () => Promise<void>) => Promise<boolean>;
  submitApproval: (type: ApprovalType, id: string, status: "APPROVED" | "REJECTED", locationId?: string | null, comment?: string, refreshOwner?: () => Promise<void>, adjustment?: boolean, payment?: PaymentAllocationInput) => Promise<boolean>;
  viewAuditLogsAdminId: string | null; adminName?: string; closeAuditLogs: () => void; payrollUser: any;
  setPayrollUser: Dispatch<SetStateAction<any>>; setPendingPaymentChange: Dispatch<SetStateAction<PaymentChange | null>>;
  load: (showLoading?: boolean) => Promise<void>; pendingExpenseApproval: Approval | null; pendingPaymentChange: PaymentChange | null;
  submitPaymentChange: (payment: PaymentAllocationInput, comment: string) => Promise<boolean>; pendingWageChange: WageChange | null;
  wageDialogOpen: boolean; wageCommitBusy: boolean; wageDialogError: string | null; setWageDialogOpen: Dispatch<SetStateAction<boolean>>;
  commitWageChange: () => Promise<void>; setPendingWageChange: Dispatch<SetStateAction<WageChange | null>>;
  setWageDialogError: Dispatch<SetStateAction<string | null>>; wageEditTriggerRef: MutableRefObject<HTMLButtonElement | null>;
}) {
  return (
    <>
      {viewDashboardUserId && dashboardUser && (
        <ModalShell
          title={dashboardUser.id === profile.id ? "ข้อมูลของตนเอง" : "ข้อมูลของพนักงาน"}
          subtitle={dashboardUser.name}
          onClose={() => setViewDashboardUserId(null)}
          nativeModal
          closeOnEscape
        >
          <EmployeeWorkspace
            profile={profile}
            targetUserId={viewDashboardUserId}
            targetPrimaryLocationId={dashboardUser.primary_location_id ?? null}
            online={online}
             expenseLocations={expenseLocations}
             hideHeading
             allowManagerActions={canManage}
             canDecide={canDecide}
             canConfigure={canConfigure}
             onApprove={canDecide ? (type, item, refreshOwner) => {
               if (type === 'TRANSACTION' && item.type === 'ADJUSTMENT') {
                 setPendingExpenseApproval({
                   type: 'TRANSACTION',
                   adjustment: true,
                   id: item.id,
                  title: `ส่วนต่างปรับยอดเบิกของ ${dashboardUser.name}`,
                  amount: Math.abs(Number(item.amount) - Number(item.adjustment_base_amount)),
                  primaryLocationId: dashboardUser.primary_location_id ?? null,
                  currentLocationId: item.source_expense_location_id ?? null,
                  refreshOwner,
                 });
                 return Promise.resolve(false);
               }
               return handleApprove(
                 type,
                 item.id,
                 type === 'TRANSACTION' && item.type === 'WITHDRAWAL'
                   ? { title: dashboardUser.id === profile.id ? "เบิกเงินของตนเอง" : `เบิกเงินของ ${item.profiles?.name || 'พนักงาน'}`, amount: Number(item.amount), primaryLocationId: dashboardUser.primary_location_id ?? null }
                   : undefined,
                 refreshOwner,
               );
             } : undefined}
             onReject={canDecide ? (type, item, refreshOwner) => submitApproval(type, item.id, 'REJECTED', undefined, undefined, refreshOwner, item.type === 'ADJUSTMENT') : undefined}
          />
        </ModalShell>
      )}

      {viewAuditLogsAdminId && (
        <AuditLogsModal
          adminId={viewAuditLogsAdminId}
          adminName={adminName ?? ""}
          onClose={closeAuditLogs}
        />
      )}
      {payrollUser && (
        <PayrollModal
          user={payrollUser}
          ownerUserId={profile.id}
          online={online}
          canDecide={canDecide}
          expenseLocations={expenseLocations}
          globalManager={canManageSystemFeatures(profile)}
          onApprove={canDecide ? (slip, refreshOwner) => handleApprove('SLIP', slip.id, Number(slip.net_pay) > 0 ? { title: `เงินเดือนของ ${payrollUser.name} เดือน ${slip.month}`, amount: Number(slip.net_pay), primaryLocationId: payrollUser.primary_location_id } : undefined, refreshOwner) : undefined}
          onReject={canDecide ? (slip, refreshOwner) => submitApproval('SLIP', slip.id, 'REJECTED', undefined, undefined, refreshOwner) : undefined}
          onChangePayment={(slip, refreshOwner) => setPendingPaymentChange({
            sourceType: 'payroll_slip',
            sourceId: slip.id,
            paymentAmount: Number(slip.net_pay) || 0,
            amountLabel: 'ยอดสุทธิที่ใช้จ่าย',
            primaryLocationId: payrollUser.primary_location_id,
            currentLocationId: slip.expense_location_id ?? null,
            refreshOwner,
          })}
          onClose={() => setPayrollUser(null)}
          onRefresh={async () => { await load(false); }}
        />
      )}
      {pendingExpenseApproval?.adjustment && (
        <ExpenseLocationChangeModal
          paymentAmount={pendingExpenseApproval.amount}
          amountLabel={pendingExpenseApproval.title}
          locations={expenseLocations}
          primaryLocationId={pendingExpenseApproval.primaryLocationId}
          currentLocationId={pendingExpenseApproval.currentLocationId}
          onClose={() => setPendingExpenseApproval(null)}
          onSubmit={async (locationId, comment) => {
            const approval = pendingExpenseApproval;
            const success = await submitApproval(approval.type, approval.id, 'APPROVED', locationId, comment, approval.refreshOwner, Boolean(approval.adjustment));
            if (success) {
              setPendingExpenseApproval(null);
            }
            return success;
          }}
       />
      )}
      {pendingExpenseApproval && !pendingExpenseApproval.adjustment && (
        <PaymentAllocationModal
          mode="approve"
          paymentAmount={pendingExpenseApproval.amount}
          amountLabel={pendingExpenseApproval.title}
          locations={expenseLocations}
          primaryLocationId={pendingExpenseApproval.primaryLocationId}
          onClose={() => setPendingExpenseApproval(null)}
          onSubmit={async (payment, comment) => {
            const approval = pendingExpenseApproval;
            const success = await submitApproval(approval.type, approval.id, 'APPROVED', undefined, comment, approval.refreshOwner, false, payment);
            if (success) setPendingExpenseApproval(null);
            return success;
          }}
        />
      )}
       {pendingPaymentChange && (
        <PaymentAllocationModal
          locations={expenseLocations}
          paymentAmount={pendingPaymentChange.paymentAmount}
          amountLabel={pendingPaymentChange.amountLabel}
          primaryLocationId={pendingPaymentChange.primaryLocationId}
          onClose={() => setPendingPaymentChange(null)}
          onSubmit={submitPaymentChange}
        />
       )}
      {pendingWageChange && (
        <WageRecalculationDialog
          open={wageDialogOpen}
          employeeName={pendingWageChange.employeeName}
          preview={pendingWageChange.preview}
          busy={wageCommitBusy}
          error={wageDialogError}
          onCancel={() => {
            if (wageCommitBusy) return;
            setWageDialogOpen(false);
          }}
          onConfirm={() => void commitWageChange()}
          onClosed={() => {
            setPendingWageChange(null);
            setWageDialogError(null);
            wageEditTriggerRef.current?.focus();
            wageEditTriggerRef.current = null;
          }}
        />
      )}
    </>
  );
}
