import type { Dispatch, SetStateAction } from "react";
import { TablePageSizeSelect, TablePagination } from "@/components/shared/TablePagination";
import { formatCurrency } from "@/lib/format";
import type { PayrollPeriodStateDto } from "@/lib/time-tracking/attendance-contract";
import { formatDailyWageCurrency } from "@/lib/time-tracking/format";
import type { Location } from "@/types";
import { formatThaiDate, payrollPeriodActionLabel } from "../display";
import { missingPayrollMonthCount } from "../employee-list";
import { TIME_TRACKING_OFFLINE_MESSAGE } from "../policy";
import { cn } from "@/lib/cn";

export function ManagerEmployeeDirectory({
  employeeSearch, setEmployeeSearch, employeeBranchFilter, setEmployeeBranchFilter, setEmployeePage,
  branchOptions, hasUnassignedUsers, activeEmployeeFilter, branchPendingCount, setEmployeeFilter,
  employeePageSize, setEmployeePageSize, visibleUsers, profileId, online, canConfigure, canManage,
  wagePreviewingUserId, wageChangeError, pendingTransactions, pendingSlips, filteredUserCount,
  currentEmployeePage, onOpenDashboard, onEditWage, onOpenPayroll,
}: {
  employeeSearch: string; setEmployeeSearch: Dispatch<SetStateAction<string>>; employeeBranchFilter: string;
  setEmployeeBranchFilter: Dispatch<SetStateAction<string>>; setEmployeePage: Dispatch<SetStateAction<number>>;
  branchOptions: Location[]; hasUnassignedUsers: boolean; activeEmployeeFilter: "pending" | "all";
  branchPendingCount: number; setEmployeeFilter: Dispatch<SetStateAction<"pending" | "all" | null>>;
  employeePageSize: number; setEmployeePageSize: Dispatch<SetStateAction<number>>; visibleUsers: any[];
  profileId: string; online: boolean; canConfigure: boolean; canManage: boolean; wagePreviewingUserId: string | null;
  wageChangeError: { userId: string; message: string } | null; pendingTransactions?: Array<{ profile_id: string }>;
  pendingSlips?: Array<{ profile_id: string }>; filteredUserCount: number; currentEmployeePage: number;
  onOpenDashboard: (id: string) => void; onEditWage: (user: any, trigger: HTMLButtonElement) => void;
  onOpenPayroll: (user: any) => void;
}) {
  const pendingCountForUser = (items: Array<{ profile_id: string }> | undefined, userId: string) =>
    items?.filter((item) => item.profile_id === userId).length || 0;
  return (
    <>
       <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
         <label className="grid gap-1 text-sm font-semibold text-ink">ค้นหาพนักงาน
           <input value={employeeSearch} onChange={(event) => { setEmployeeSearch(event.target.value); setEmployeePage(1); }} className="focus-ring h-10 rounded-md border border-black/15 bg-white px-3" placeholder="ชื่อพนักงาน" />
         </label>
         <div className="flex flex-wrap items-end gap-3">
           <label className="grid gap-1 text-sm font-semibold text-ink">กรองสาขา
             <select value={employeeBranchFilter} onChange={(event) => { setEmployeeBranchFilter(event.target.value); setEmployeePage(1); }} className="focus-ring h-10 rounded-md border border-black/15 bg-white px-3">
               <option value="all">ทุกสาขา</option>
               {branchOptions.map((location: Location) => <option key={location.id} value={location.id}>{location.name}</option>)}
               {hasUnassignedUsers && <option value="unassigned">ไม่มีสาขาหลัก</option>}
             </select>
           </label>
           <div className="flex flex-wrap gap-2" aria-label="กรองตามสถานะ">
             {(["pending", "all"] as const).map((filter) => {
               const selected = activeEmployeeFilter === filter;
                const label = filter === "pending" ? "งานค้าง" : "ทั้งหมด";
               const accessibleLabel = filter === "pending" && branchPendingCount > 0
                 ? `${label} ${branchPendingCount} รายการ`
                 : label;
               return (
                 <button
                   key={filter}
                   type="button"
                   aria-pressed={selected}
                   aria-label={accessibleLabel}
                   onClick={() => { setEmployeeFilter(filter); setEmployeePage(1); }}
                   className={cn(
                     "focus-ring inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-semibold",
                     selected
                       ? "border-leaf bg-leaf text-white hover:bg-leaf/90"
                       : "border-black/15 bg-white text-ink hover:bg-field",
                   )}
                 >
                   {label}
                   {filter === "pending" && branchPendingCount > 0 && (
                     <span aria-hidden="true" className="min-w-5 rounded-full bg-clay px-1.5 py-0.5 text-center text-xs font-bold leading-none text-white tabular-nums">
                       {branchPendingCount > 99 ? "99+" : branchPendingCount}
                     </span>
                   )}
                 </button>
               );
             })}
           </div>
           <TablePageSizeSelect pageSize={employeePageSize} onPageSizeChange={(size) => { setEmployeePageSize(size); setEmployeePage(1); }} />
         </div>
       </div>

       <div className="bg-white p-4 rounded-xl border border-black/10 shadow-sm overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead>
            <tr className="border-b border-black/10 text-ink/65">
              <th className="pb-3 font-semibold">จัดการ</th>
              <th className="pb-3 font-semibold">พนักงาน</th>
              <th className="pb-3 font-semibold">ค่าแรง/วัน</th>
              <th className="pb-3 font-semibold">สถานะ</th>
              <th className="pb-3 font-semibold">หนี้สิน</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
             {visibleUsers.map((user: any) => {
               const isSelf = user.id === profileId;
                  const periodState = user.period_state as PayrollPeriodStateDto | undefined;
                  const status = periodState?.currentStatus === "ACTIVE" ? 'ACTIVE_PERIOD' : 'INACTIVE_PERIOD';
               const debtRemainingAmount = Number(user.debt_remaining_amount || 0);
                const dashboardPendingCount = pendingCountForUser(pendingTransactions, user.id);
                const payrollPendingCount = pendingCountForUser(pendingSlips, user.id);
                const missingPayrollCount = missingPayrollMonthCount(user);
                const payrollWorkCount = payrollPendingCount + missingPayrollCount;
               const overviewAction = canManage
                 ? `จัดการปฏิทินวันทำงานของ ${user.name}`
                 : `ดูข้อมูลเวลาและเงินเดือนของ ${user.name}`;
               const overviewLabel = dashboardPendingCount > 0
                 ? `${overviewAction} มีรายการรออนุมัติ ${dashboardPendingCount} รายการ`
                 : overviewAction;
                const payrollLabel = payrollWorkCount > 0
                  ? `จัดการสลิปเงินเดือนของ ${user.name} มีงานค้าง ${payrollWorkCount} รายการ สลิปรออนุมัติ ${payrollPendingCount} รายการ ขาดสลิป ${missingPayrollCount} เดือน`
                  : `จัดการสลิปเงินเดือนของ ${user.name}`;
               return (
                <tr
                  key={user.id}
                  data-user-id={user.id}
                  data-time-payroll-self={isSelf ? "true" : undefined}
                  className="hover:bg-sand/30 data-[time-payroll-self=true]:bg-mint/35"
                >
                  <td className="py-3 pr-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (!online) { alert(TIME_TRACKING_OFFLINE_MESSAGE); return; }
                          onOpenDashboard(user.id);
                        }}
                        disabled={!online}
                        title={online ? overviewLabel : TIME_TRACKING_OFFLINE_MESSAGE}
                        aria-label={overviewLabel}
                        className="focus-ring relative inline-flex size-10 items-center justify-center rounded-md bg-river text-lg text-white hover:bg-river/90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span aria-hidden="true">🗓️</span>
                        {dashboardPendingCount > 0 && <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-4 rounded-full bg-clay px-1 py-0.5 text-[10px] leading-none text-white">{dashboardPendingCount}</span>}
                      </button>
                      {canConfigure && (
                        <button
                          type="button"
                          onClick={(event) => {
                            onEditWage(user, event.currentTarget);
                          }}
                          disabled={!online || wagePreviewingUserId !== null}
                          title={online ? `แก้ไขค่าแรงรายวันของ ${user.name}` : TIME_TRACKING_OFFLINE_MESSAGE}
                          aria-label={`แก้ไขค่าแรงรายวันของ ${user.name}`}
                          className="focus-ring inline-flex size-10 items-center justify-center rounded-md bg-amber text-lg text-white hover:bg-amber/90 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <span aria-hidden="true">✏️</span>
                        </button>
                      )}
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => onOpenPayroll(user)}
                          disabled={!online}
                          title={online ? payrollLabel : TIME_TRACKING_OFFLINE_MESSAGE}
                          aria-label={payrollLabel}
                          className="focus-ring relative inline-flex size-10 items-center justify-center rounded-md bg-leaf text-lg text-white hover:bg-leaf/80 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span aria-hidden="true">🧾</span>
                          {payrollWorkCount > 0 && <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-4 rounded-full bg-clay px-1 py-0.5 text-center text-[10px] leading-none text-white tabular-nums">{payrollWorkCount > 99 ? "99+" : payrollWorkCount}</span>}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="py-3">
                     {user.name}
                     {isSelf && <span className="ml-2 rounded border border-leaf/20 bg-mint px-1.5 py-0.5 text-xs font-semibold text-leaf">ของตนเอง</span>}
                     {missingPayrollCount > 0 && <span className="ml-2 rounded-full bg-clay/10 px-2 py-0.5 text-xs font-bold text-clay tabular-nums">ขาดสลิป {missingPayrollCount} เดือน</span>}
                  </td>
                  <td className="py-3">
                    <span className="tabular-nums">{formatDailyWageCurrency(user.daily_wage || 0)}</span>
                    {wageChangeError?.userId === user.id && (
                      <p role="alert" className="mt-1 max-w-56 text-pretty text-xs font-semibold text-rose-700">
                        {wageChangeError?.message}
                      </p>
                    )}
                  </td>
                    <td className="py-3">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${status === 'ACTIVE_PERIOD' ? 'bg-leaf/20 text-leaf' : 'bg-black/10 text-ink/60'}`}>
                        {status === 'ACTIVE_PERIOD' ? 'กำลังคิดค่าแรง' : 'ไม่ได้คิดค่าแรง'}
                      </span>
                      {periodState?.nextAction && (
                        <p className="mt-1 text-pretty text-xs text-amber">
                          กำหนด{payrollPeriodActionLabel(periodState.nextAction.action)} · {formatThaiDate(periodState.nextAction.activationOn)}
                        </p>
                      )}
                   </td>
                  <td className="py-3">
                     <span className="text-clay font-bold">{formatCurrency(debtRemainingAmount)}</span>
                  </td>
                </tr>
              )
            })}
           </tbody>
         </table>
         {filteredUserCount === 0 && <p className="py-8 text-center text-sm text-ink/55">ไม่พบพนักงานตามตัวกรอง</p>}
       </div>
       <TablePagination totalItems={filteredUserCount} page={currentEmployeePage} pageSize={employeePageSize} onPageChange={setEmployeePage} />
    </>
  );
}
