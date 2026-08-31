const ATTENDANCE_MODES = ["EXCEPTIONS"] as const;
type AttendanceMode = (typeof ATTENDANCE_MODES)[number];

const ATTENDANCE_EXCEPTION_STATUSES = ["HALF_DAY", "OFF"] as const;
type AttendanceExceptionStatus = (typeof ATTENDANCE_EXCEPTION_STATUSES)[number];

const PAYROLL_PERIOD_ACTIONS = ["ENABLE", "PAUSE", "RESUME", "END"] as const;
export type PayrollPeriodAction = (typeof PAYROLL_PERIOD_ACTIONS)[number];

export interface TimePayrollSettingsDto {
  mode: AttendanceMode;
  workdayEndTime: string;
  pendingWorkdayEndTime: string | null;
  pendingEffectiveDate: string | null;
  activatedOn: string | null;
}

export interface AttendancePeriodDto {
  id: string;
  startOn: string;
  endOn: string | null;
}

export interface AttendanceExceptionDto {
  date: string;
  status: AttendanceExceptionStatus;
}

interface AttendanceSummaryDto {
  fullDays: number;
  halfDays: number;
  offDays: number;
  paidDays: number;
  grossPay: number;
}

export interface AttendanceMonthDto {
  month: string;
  mode: AttendanceMode;
  workdayEndTime: string;
  eligibleThrough: string;
  periods: AttendancePeriodDto[];
  exceptions: AttendanceExceptionDto[];
  summary: AttendanceSummaryDto;
}
