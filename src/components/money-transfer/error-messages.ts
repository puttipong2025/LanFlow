export function getMoneyTransferMergeFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("ไม่มีสิทธิ์")) return message;
  if (message.includes("REPORT_LOCKED")) return "มีรายการถูก Report Lock ระหว่างการรวม กรุณาโหลดข้อมูลแล้วลองใหม่";
  return "รวมรายการรอโอนไม่สำเร็จ";
}

export function getMoneyTransferReportLockedDeleteMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const reportNo = message.match(/REPORT_LOCKED:([A-Z0-9-]+)/i)?.[1];
  return reportNo ? `รายการโอนเงินนี้ถูกล็อกโดยรายงาน ${reportNo} ต้องลบรายงานล่าสุดตามลำดับก่อน แล้วจึงลองลบรายการอีกครั้ง` : null;
}

export function getMoneyTransferSaveFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message.trim() : "";
  const reportNo = message.match(/REPORT_LOCKED:([A-Z0-9-]+)/i)?.[1];
  if (reportNo) return `รายการถูกล็อกโดยรายงาน ${reportNo} ต้องลบรายงานล่าสุดตามลำดับก่อน`;
  return message || "บันทึกรายการโอนเงินไม่สำเร็จ กรุณาลองใหม่";
}
