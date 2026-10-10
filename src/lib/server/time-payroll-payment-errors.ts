type TimePayrollPaymentRpcError = {
  status: 400 | 403 | 404 | 409;
  message: string;
};

export function mapTimePayrollPaymentRpcError(message: string): TimePayrollPaymentRpcError | null {
  if (/PAYMENT_AMOUNT_CHANGED/i.test(message)) {
    return { status: 409, message: "ยอดรายการเปลี่ยนแล้ว กรุณารีเฟรชและเลือกวิธีจ่ายใหม่" };
  }
  if (/PAYMENT_BRANCH_DENIED/i.test(message)) {
    return { status: 403, message: "คุณไม่มีสิทธิ์ใช้สาขาที่เลือกสำหรับวิธีจ่ายนี้" };
  }
  if (/PAYMENT_BRANCH_REQUIRED/i.test(message)) {
    return { status: 400, message: "กรุณาเลือกสาขาที่จ่ายส่วนต่าง" };
  }
  if (/PAYMENT_DELETE_REQUIRES_MONEY_TRANSFER_ACCESS/i.test(message)) {
    return { status: 403, message: "ต้องมีสิทธิ์รายการโอนเงินและสิทธิ์สาขาจึงจะลบรายการนี้ได้" };
  }
  if (/PAYMENT_SOURCE_NOT_FOUND/i.test(message)) {
    return { status: 404, message: "ไม่พบรายการเวลาและเงินเดือนต้นทาง" };
  }
  if (/PAYMENT_TRANSFER_HAS_SLIPS/i.test(message)) {
    return { status: 409, message: "รายการโอนมีสลิปแล้ว จึงเปลี่ยนวิธีจ่ายไม่ได้" };
  }
  if (/PAYMENT_USE_ALLOCATION_API/i.test(message)) {
    return { status: 409, message: "วิธีจ่ายของรายการนี้เปลี่ยนแล้ว กรุณารีเฟรชและเลือกวิธีจ่ายใหม่" };
  }
  if (/PAYMENT_ALREADY_DECIDED/i.test(message)) {
    return { status: 409, message: "รายการนี้กำหนดวิธีจ่ายแล้ว กรุณารีเฟรชข้อมูล" };
  }
  if (/PAYMENT_SOURCE_NOT_APPROVED/i.test(message)) {
    return { status: 409, message: "เปลี่ยนวิธีจ่ายได้เฉพาะรายการที่อนุมัติแล้ว" };
  }
  if (/PAYMENT_REQUIRED/i.test(message)) {
    return { status: 400, message: "กรุณาเลือกวิธีจ่ายก่อนอนุมัติรายการ" };
  }
  if (/PAYMENT_INVALID_SPLIT/i.test(message)) {
    return { status: 400, message: "ยอดโอนต้องอยู่ระหว่าง 0 ถึงยอดรายการ และมีทศนิยมไม่เกิน 2 ตำแหน่ง" };
  }
  if (/PAYMENT_INVALID_OUTSIDE_SYSTEM/i.test(message)) {
    return { status: 400, message: "ข้อมูลจ่ายนอกระบบไม่ถูกต้อง" };
  }
  if (/PAYMENT_INVALID_(CHANNEL|PAYLOAD|SOURCE|SOURCE_AMOUNT)/i.test(message)) {
    return { status: 400, message: "ข้อมูลวิธีจ่ายไม่ถูกต้อง" };
  }
  return null;
}
