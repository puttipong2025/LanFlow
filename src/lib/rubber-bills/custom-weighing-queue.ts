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

const CUSTOM_QUEUE_NUMBER_MIN = 1;
const CUSTOM_QUEUE_NUMBER_MAX = 9999;
const CUSTOM_QUEUE_NUMBER_MAX_DIGITS = 4;

type CustomWeighingQueueTicket = {
  queueNumber: number;
  issuedDate: string;
  issuedTime: string;
};

export function sanitizeCustomQueueNumberInput(value: string) {
  return value.replace(/\D/g, "").slice(0, CUSTOM_QUEUE_NUMBER_MAX_DIGITS);
}

export function parseCustomQueueNumber(value: string) {
  if (!/^\d+$/.test(value) || value.length > CUSTOM_QUEUE_NUMBER_MAX_DIGITS) return null;
  const queueNumber = Number(value);
  return queueNumber >= CUSTOM_QUEUE_NUMBER_MIN && queueNumber <= CUSTOM_QUEUE_NUMBER_MAX
    ? queueNumber
    : null;
}

export function buildCustomWeighingQueueTicket(
  queueNumber: number,
  issuedAt = new Date(),
): CustomWeighingQueueTicket {
  if (
    !Number.isInteger(queueNumber)
    || queueNumber < CUSTOM_QUEUE_NUMBER_MIN
    || queueNumber > CUSTOM_QUEUE_NUMBER_MAX
  ) {
    throw new Error("เลขลำดับคิวต้องอยู่ระหว่าง 1–9999");
  }

  return {
    queueNumber,
    issuedDate: THAI_DATE_FORMATTER.format(issuedAt),
    issuedTime: THAI_TIME_FORMATTER.format(issuedAt),
  };
}

export function renderCustomWeighingQueueTicketHtml(ticket: CustomWeighingQueueTicket) {
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <title>บัตรคิว</title>
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
    .title { font-size: 18px; font-weight: 900; }
    .queue-label { margin-top: 3mm; font-size: 13px; font-weight: 700; }
    .queue-number {
      margin-top: 1mm;
      font-size: 52px;
      line-height: 1;
      font-weight: 900;
      overflow-wrap: anywhere;
    }
    .issued-at {
      margin-top: 4mm;
      border-top: 1px dashed #000;
      padding-top: 3mm;
      font-size: 13px;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <div class="title">บัตรคิว</div>
  <div class="queue-label">เลขลำดับคิว</div>
  <div class="queue-number">${ticket.queueNumber}</div>
  <div class="issued-at">ออกบัตร ${ticket.issuedDate} เวลา ${ticket.issuedTime} น.</div>
</body>
</html>`;
}
