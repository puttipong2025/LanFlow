import { bangkokDateString } from "@/lib/bangkok-date";

export const WEIGHING_WAIT_OPTIONS = [5, 10, 15, 30, 40, 60, 120, 180] as const;

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
  queueNumber: number;
  customerName: string | null;
  issuedDate: string;
  issuedTime: string;
  appointmentDate: string;
  appointmentTime: string;
  isNextDay: boolean;
};

type BuildWeighingAppointmentTicketInput = {
  waitMinutes: number;
  queueNumber: number;
  customerName?: string;
  issuedAt?: Date;
};

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildWeighingAppointmentTicket({
  waitMinutes,
  queueNumber,
  customerName = "",
  issuedAt = new Date(),
}: BuildWeighingAppointmentTicketInput): WeighingAppointmentTicket {
  if (!WEIGHING_WAIT_OPTIONS.includes(waitMinutes as (typeof WEIGHING_WAIT_OPTIONS)[number])) {
    throw new Error("ช่วงเวลารอไม่ถูกต้อง");
  }
  if (!Number.isInteger(queueNumber) || queueNumber < 1 || queueNumber > 9_999) {
    throw new Error("เลขคิวบัตรนัดไม่ถูกต้อง");
  }

  const appointmentAt = new Date(issuedAt.getTime() + waitMinutes * 60_000);
  const normalizedCustomerName = customerName.trim().slice(0, 100);

  return {
    waitMinutes,
    queueNumber,
    customerName: normalizedCustomerName || null,
    issuedDate: THAI_DATE_FORMATTER.format(issuedAt),
    issuedTime: THAI_TIME_FORMATTER.format(issuedAt),
    appointmentDate: THAI_DATE_FORMATTER.format(appointmentAt),
    appointmentTime: THAI_TIME_FORMATTER.format(appointmentAt),
    isNextDay: bangkokDateString(issuedAt) !== bangkokDateString(appointmentAt),
  };
}

export function isWeighingAppointmentDraftCurrentDay(issuedAt: Date, now = new Date()) {
  return bangkokDateString(issuedAt) === bangkokDateString(now);
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
    .queue { padding: 2mm 0 4mm; border-bottom: 2px solid #000; }
    .queue-label { font-size: 14px; font-weight: 800; }
    .queue-number { margin-top: 1mm; font-size: 44px; line-height: 1; font-weight: 900; }
    .customer { overflow-wrap: anywhere; }
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
  <div class="queue">
    <div class="queue-label">เลขคิวบัตรนัด</div>
    <div class="queue-number">${ticket.queueNumber}</div>
  </div>
  ${
    ticket.customerName
      ? `<div class="row customer">
    <span class="label">ชื่อลูกค้า</span>
    <div class="value">${escapeHtml(ticket.customerName)}</div>
  </div>`
      : ""
  }
  <div class="appointment row">
    <div class="appointment-label">เวลานัดชั่ง</div>
    <div class="appointment-date">วันที่ ${ticket.appointmentDate}</div>
    <div class="appointment-time">ชั่งเวลา ${ticket.appointmentTime} น.</div>
    ${ticket.isNextDay ? '<div class="next-day">(วันถัดไป)</div>' : ""}
  </div>
  <div class="row">
    <span class="label">เวลาที่ออกบัตร</span>
    <div class="value">${ticket.issuedDate} ${ticket.issuedTime} น.</div>
  </div>
  <div class="row">
    <span class="label">ระยะเวลารอ</span>
    <div class="value">${ticket.waitMinutes} นาที</div>
  </div>
</body>
</html>`;
}
