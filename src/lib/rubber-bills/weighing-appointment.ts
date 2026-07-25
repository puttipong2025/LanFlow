import { bangkokDateString } from "@/lib/bangkok-date";

export const WEIGHING_WAIT_OPTIONS = [5, 10, 15, 30, 40, 60] as const;

const THAI_DATE_FORMATTER = new Intl.DateTimeFormat("th-TH-u-ca-buddhist-nu-latn", {
  timeZone: "Asia/Bangkok",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const THAI_TIME_FORMATTER = new Intl.DateTimeFormat("th-TH-u-ca-buddhist-nu-latn", {
  timeZone: "Asia/Bangkok",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export type WeighingAppointmentTicket = {
  waitMinutes: number;
  issuedDate: string;
  issuedTime: string;
  appointmentDate: string;
  appointmentTime: string;
  isNextDay: boolean;
};

export function buildWeighingAppointmentTicket(
  waitMinutes: number,
  issuedAt = new Date(),
): WeighingAppointmentTicket {
  if (!WEIGHING_WAIT_OPTIONS.includes(waitMinutes as (typeof WEIGHING_WAIT_OPTIONS)[number])) {
    throw new Error("ช่วงเวลารอไม่ถูกต้อง");
  }

  const appointmentAt = new Date(issuedAt.getTime() + waitMinutes * 60_000);

  return {
    waitMinutes,
    issuedDate: THAI_DATE_FORMATTER.format(issuedAt),
    issuedTime: THAI_TIME_FORMATTER.format(issuedAt),
    appointmentDate: THAI_DATE_FORMATTER.format(appointmentAt),
    appointmentTime: THAI_TIME_FORMATTER.format(appointmentAt),
    isNextDay: bangkokDateString(issuedAt) !== bangkokDateString(appointmentAt),
  };
}

export function renderWeighingAppointmentHtml(ticket: WeighingAppointmentTicket) {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <title>บัตรนัดชั่ง</title>
  <style>
    @page { size: 80mm auto; margin: 3mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      width: 74mm;
      color: #000;
      font-family: Arial, "Noto Sans Thai", sans-serif;
      text-align: center;
    }
    .row { padding: 3mm 0; border-bottom: 1px dashed #000; }
    .label { display: block; margin-bottom: 1mm; font-size: 11px; }
    .value { font-size: 18px; font-weight: 800; }
    .appointment { padding-top: 4mm; }
    .appointment-label { font-size: 15px; font-weight: 800; }
    .appointment-date { margin-top: 2mm; font-size: 16px; font-weight: 700; }
    .appointment-time {
      margin-top: 2mm;
      font-size: 30px;
      line-height: 1.15;
      font-weight: 900;
      white-space: nowrap;
    }
    .next-day { margin-top: 2mm; font-size: 14px; font-weight: 800; }
  </style>
</head>
<body>
  <div class="row">
    <span class="label">เวลาที่ออกบัตร</span>
    <div class="value">${ticket.issuedDate} ${ticket.issuedTime} น.</div>
  </div>
  <div class="row">
    <span class="label">ระยะเวลารอ</span>
    <div class="value">${ticket.waitMinutes} นาที</div>
  </div>
  <div class="appointment">
    <div class="appointment-label">เวลานัดชั่ง</div>
    <div class="appointment-date">วันที่ ${ticket.appointmentDate}</div>
    <div class="appointment-time">ชั่งเวลา ${ticket.appointmentTime} น.</div>
    ${ticket.isNextDay ? '<div class="next-day">(วันถัดไป)</div>' : ""}
  </div>
</body>
</html>`;
}
