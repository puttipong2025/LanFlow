import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import { authFetch } from "@/lib/auth-fetch";
import type { AttendanceExceptionDto, AttendanceMonthDto, PayrollPeriodAction } from "@/lib/time-tracking/attendance-contract";
import { formatPayrollCurrency } from "@/lib/time-tracking/format";
import type { AttendanceDeductionResult } from "../contracts";
import { TIME_TRACKING_OFFLINE_MESSAGE } from "../policy";

function notifyAttendanceSaved(result: AttendanceDeductionResult | undefined, fallback: string) {
  if (!result?.deductionsChanged) {
    toast.success(fallback);
    return;
  }
  toast.success("บันทึกและคำนวณยอดหักใหม่แล้ว", {
    description: `ยอดหักเดือนเปิด ${formatPayrollCurrency(Number(result.oldOpenDeduction) || 0)} → ${formatPayrollCurrency(Number(result.newOpenDeduction) || 0)}`,
  });
}

export function createEmployeeAttendanceActions({
  online,
  canConfigure,
  attendance,
  managedUserId,
  setSaving,
  loadData,
}: {
  online: boolean;
  canConfigure: boolean;
  attendance: AttendanceMonthDto | undefined;
  managedUserId: string;
  setSaving: Dispatch<SetStateAction<boolean>>;
  loadData: () => Promise<void>;
}) {
  async function replaceAttendanceExceptions(selections: AttendanceExceptionDto[]) {
    if (!online) return TIME_TRACKING_OFFLINE_MESSAGE;
    if (!attendance) return "ไม่พบข้อมูลปฏิทินวันทำงาน กรุณาโหลดใหม่";
    setSaving(true);
    try {
      const response = await authFetch("/api/lanflow/time-tracking/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "REPLACE_ATTENDANCE_EXCEPTIONS",
          payload: { user_id: managedUserId, month: attendance.month, selections },
        }),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        return json?.error || "บันทึกปฏิทินไม่สำเร็จ";
      }
      const json = await response.json() as { result?: AttendanceDeductionResult };
      await loadData();
      notifyAttendanceSaved(json.result, "บันทึกปฏิทินแล้ว");
      return null;
    } catch (error) {
      console.error(error);
      return "บันทึกปฏิทินไม่สำเร็จ";
    } finally {
      setSaving(false);
    }
  }

  async function setPayrollPeriod(action: PayrollPeriodAction, effectiveDate: string) {
    if (!online) return TIME_TRACKING_OFFLINE_MESSAGE;
    if (!canConfigure) return "คุณไม่มีสิทธิ์เปลี่ยนช่วงทำงาน";
    setSaving(true);
    try {
      const response = await authFetch("/api/lanflow/time-tracking/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SET_PAYROLL_ACTIVE_PERIOD",
          payload: { user_id: managedUserId, action, effective_date: effectiveDate },
        }),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        return json?.error || "บันทึกช่วงทำงานไม่สำเร็จ กรุณาลองใหม่";
      }
      await loadData();
      return null;
    } catch (error) {
      console.error(error);
      return "บันทึกช่วงทำงานไม่สำเร็จ กรุณาลองใหม่";
    } finally {
      setSaving(false);
    }
  }

  async function cancelPayrollPeriodSchedule() {
    if (!online) return TIME_TRACKING_OFFLINE_MESSAGE;
    if (!canConfigure) return "คุณไม่มีสิทธิ์เปลี่ยนช่วงทำงาน";
    setSaving(true);
    try {
      const response = await authFetch("/api/lanflow/time-tracking/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CANCEL_PAYROLL_ACTIVE_PERIOD_SCHEDULE",
          payload: { user_id: managedUserId },
        }),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        return json?.error || "ยกเลิกกำหนดการไม่สำเร็จ กรุณาลองใหม่";
      }
      await loadData();
      return null;
    } catch (error) {
      console.error(error);
      return "ยกเลิกกำหนดการไม่สำเร็จ กรุณาลองใหม่";
    } finally {
      setSaving(false);
    }
  }

  async function correctPayrollPeriodStart(periodId: string, startOn: string) {
    if (!online) return TIME_TRACKING_OFFLINE_MESSAGE;
    if (!canConfigure) return "คุณไม่มีสิทธิ์เปลี่ยนช่วงทำงาน";
    setSaving(true);
    try {
      const response = await authFetch("/api/lanflow/time-tracking/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CORRECT_PAYROLL_PERIOD_START",
          payload: { user_id: managedUserId, period_id: periodId, start_on: startOn },
        }),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        return json?.error || "แก้วันเริ่มช่วงทำงานไม่สำเร็จ กรุณาลองใหม่";
      }
      const json = await response.json() as { result?: AttendanceDeductionResult };
      await loadData();
      notifyAttendanceSaved(json.result, "แก้วันเริ่มช่วงทำงานแล้ว");
      return null;
    } catch (error) {
      console.error(error);
      return "แก้วันเริ่มช่วงทำงานไม่สำเร็จ กรุณาลองใหม่";
    } finally {
      setSaving(false);
    }
  }
  return {
    replaceAttendanceExceptions,
    setPayrollPeriod,
    cancelPayrollPeriodSchedule,
    correctPayrollPeriodStart,
  };
}

