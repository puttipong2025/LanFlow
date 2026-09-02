type AttendanceMode = "EXCEPTIONS";
type AttendanceExceptionStatus = "HALF_DAY" | "OFF";
export type PayrollPeriodAction = "ENABLE" | "PAUSE" | "RESUME" | "END";

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

interface PayrollScheduledActionDto {
  action: PayrollPeriodAction;
  selectedEffectiveOn: string;
  activationOn: string;
}

interface PayrollResumeCorrectionDto {
  currentStartOn: string;
  earliestOn: string;
}

export interface PayrollPeriodStateDto {
  currentStatus: "ACTIVE" | "INACTIVE";
  currentPeriod: AttendancePeriodDto | null;
  nextAction: PayrollScheduledActionDto | null;
  hasPeriodHistory: boolean;
  resumeEarliestOn: string | null;
  resumeCorrection: PayrollResumeCorrectionDto | null;
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
