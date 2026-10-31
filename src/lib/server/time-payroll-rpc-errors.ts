export function rpcErrorStatus(message: string) {
  if (/ADJUSTMENT_NOT_LATEST|CASH_COUNT_ACTIVE|ADJUSTMENT_NOT_FOUND|Transaction not found/i.test(message)) return 409;
  if (/Authentication required/i.test(message)) return 401;
  if (/Forbidden|access denied/i.test(message)) return 403;
  if (/PAYROLL_AMOUNT_CHANGED|WAGE_PREVIEW_STALE|WAGE_PREVIEW_REQUIRED|MONTH_CLOSED|PENDING_PERIOD_ACTION|DEDUCTION_LOCKED|DEDUCTION_WAGE_LOCKED|PENDING_BLOCKER|OLDER_WORK_MONTH|DELETE_NEWER_SLIP_FIRST|REPORT_LOCKED|NO_PERIOD_HISTORY_TO_RESUME|RESUME_BEFORE_LAST_END_DATE|PERIOD_START_CORRECTION_STALE|ADJUSTMENT_(STALE|NO_OP|PENDING_EXISTS|ALREADY_DECIDED|BELOW_CLOSED_FLOOR)|already been decided/i.test(message)) return 409;
  return 400;
}

export function rpcErrorMessage(message: string) {
  if (/Authentication required/i.test(message)) return "กรุณาเข้าสู่ระบบใหม่ก่อนทำรายการ";
  if (/CASH_COUNT_ACTIVE/i.test(message)) return "สาขากำลังนับเงิน กรุณารอให้บันทึก ยกเลิก หรือหมดเวลาก่อน";
  if (/ADJUSTMENT_NOT_LATEST/i.test(message)) return "ลบได้เฉพาะการปรับยอดล่าสุด กรุณารีเฟรชข้อมูล";
  if (/ADJUSTMENT_NOT_FOUND|Transaction not found/i.test(message)) return "ไม่พบรายการนี้ อาจถูกลบแล้ว กรุณารีเฟรชข้อมูล";
  if (/PAYROLL_AMOUNT_CHANGED/i.test(message)) return "ยอดเงินเดือนเปลี่ยนแล้ว กรุณาปิดหน้าต่างและตรวจยอดใหม่ก่อนสร้างสลิป";
  if (/Existing expense location access denied/i.test(message)) return "รายการนี้จ่ายจากสาขานอกขอบเขต กรุณาให้ผู้จัดการระบบจัดการ";
  const reportLock = message.match(/REPORT_LOCKED:([A-Z0-9-]+)(?::PAYROLL_SLIP:([0-9]{4}-[0-9]{2}):([A-Z]+):([0-9a-f-]+))?/i);
  if (reportLock) {
    return reportLock[2]
      ? `เดือน ${reportLock[2]} ล็อกโดยรายงาน ${reportLock[1]} (${reportLock[3]}) — ต้องลบรายงานล่าสุดตามลำดับก่อน`
      : `ล็อกโดยรายงาน ${reportLock[1]} — ต้องลบรายงานล่าสุดตามลำดับก่อน`;
  }

  const closed = message.match(/MONTH_CLOSED:([0-9]{4}-[0-9]{2})(?::PAYROLL_SLIP:([A-Z]+):([0-9a-f-]+))?/i);
  if (closed) {
    return closed[2]
      ? `เดือน ${closed[1]} มีสลิปเงินเดือนสถานะ ${closed[2]} (รายการ ${closed[3]}) กรุณาลบสลิปก่อน`
      : `เดือน ${closed[1]} มีสลิปเงินเดือนแล้ว กรุณาลบสลิปก่อน`;
  }

  const pendingPeriodMonth = message.match(/PENDING_PERIOD_ACTION:([0-9]{4}-[0-9]{2})/)?.[1];
  if (pendingPeriodMonth) return `เดือน ${pendingPeriodMonth} มีการเปลี่ยนสถานะเงินเดือนรอมีผล กรุณายกเลิกหรือเปลี่ยนกำหนดการก่อนสร้างสลิป`;

  const deduction = message.match(/DEDUCTION_LOCKED:([0-9]{4}-[0-9]{2})(?::([A-Z_]+):([0-9a-f-]+))?/i);
  if (deduction) {
    const label = deduction[2] === "WITHDRAWAL_DEDUCTION" ? "หักเงินเบิก" : "หักหนี้";
    return deduction[3]
      ? `เดือน ${deduction[1]} มีรายการ${label}เงินจริงแล้ว (รายการ ${deduction[3]}) จึงแก้วันทำงานย้อนหลังไม่ได้`
      : `เดือน ${deduction[1]} มีรายการหักเงินจริงแล้ว จึงแก้วันทำงานย้อนหลังไม่ได้`;
  }
  if (/DEDUCTION_WAGE_LOCKED/i.test(message)) return "มีเดือนที่หักเงินจริงแล้วแต่ยังไม่ได้ออกสลิป จึงแก้ค่าแรงไม่ได้";
  if (/WAGE_PREVIEW_STALE/i.test(message)) return "ข้อมูลค่าแรงหรือยอดหักเปลี่ยนแล้ว กรุณาตรวจ Preview ใหม่ก่อนยืนยัน";
  if (/WAGE_PREVIEW_REQUIRED/i.test(message)) return "กรุณาตรวจ Preview ค่าแรงก่อนยืนยัน";

  const pending = message.match(/PENDING_BLOCKER:(DEBT|WITHDRAWAL|ADJUSTMENT):([0-9a-f-]+):([0-9]{4}-[0-9]{2})/i);
  if (pending) {
    const label = pending[1].toUpperCase() === "DEBT"
      ? "หนี้"
      : pending[1].toUpperCase() === "ADJUSTMENT" ? "ปรับยอดเบิก" : "เบิกเงิน";
    return `ยังมีรายการ${label}เดือน ${pending[3]} รออนุมัติ กรุณาอนุมัติ ปฏิเสธ หรือลบก่อน`;
  }

  const olderMonth = message.match(/OLDER_WORK_MONTH:([0-9]{4}-[0-9]{2})/)?.[1];
  if (olderMonth) return `ต้องสร้างสลิปเดือน ${olderMonth} ก่อน`;

  const newerMonth = message.match(/DELETE_NEWER_SLIP_FIRST:([0-9]{4}-[0-9]{2})/)?.[1];
  if (newerMonth) return `ต้องลบสลิปเดือน ${newerMonth} ก่อน`;

  const noWorkMonth = message.match(/NO_WORK_MONTH:([0-9]{4}-[0-9]{2})/)?.[1];
  if (noWorkMonth) return `เดือน ${noWorkMonth} ไม่มีวันทำงาน จึงไม่ต้องสร้างสลิป`;

  if (/FUTURE_EFFECTIVE_DATE/i.test(message)) return "วันที่รายการต้องไม่เกินวันปัจจุบัน";
  if (/END_DATE_IN_PAST/i.test(message)) return "สิ้นสุดงานย้อนหลังไม่ได้ กรุณาเลือกวันนี้หรือวันในอนาคต";
  const overlapEnd = message.match(/RESUME_OVERLAPS_PREVIOUS_PERIOD:([0-9]{4}-[0-9]{2}-[0-9]{2})/)?.[1];
  if (overlapEnd) return `วันที่กลับเข้าทำงานต้องหลังช่วงเดิมซึ่งสิ้นสุด ${overlapEnd}`;
  const lastEndDate = message.match(/RESUME_BEFORE_LAST_END_DATE:([0-9]{4}-[0-9]{2}-[0-9]{2})/)?.[1];
  if (lastEndDate) return `วันที่กลับเข้าทำงานต้องไม่ก่อนวันที่สิ้นสุดล่าสุด ${lastEndDate}`;
  if (/NO_PERIOD_HISTORY_TO_RESUME/i.test(message)) return "ไม่พบประวัติช่วงทำงานเดิม กรุณาใช้เปิดใช้เงินเดือน";
  if (/NO_RESUME_PERIOD_TO_CORRECT/i.test(message)) return "แก้ได้เฉพาะช่วงทำงานปัจจุบันที่สร้างจากการกลับเข้าทำงานล่าสุด";
  if (/INVALID_RESUME_CORRECTION/i.test(message)) return "กรุณาเลือกวันกลับเข้าทำงานใหม่ที่ต่างจากวันเดิม";
  if (/RESUME_CORRECTION_DATE_IN_FUTURE/i.test(message)) return "วันกลับเข้าทำงานใหม่ต้องไม่เกินวันนี้";
  if (/RESUME_CORRECTION_AFTER_PENDING_ACTION/i.test(message)) return "วันกลับเข้าทำงานใหม่ต้องอยู่ก่อนกำหนดการพักหรือสิ้นสุดงาน";
  if (/PERIOD_START_CORRECTION_STALE/i.test(message)) return "ช่วงทำงานเปลี่ยนแล้ว กรุณารีเฟรชและตรวจสอบช่วงล่าสุดอีกครั้ง";
  if (/NO_PERIOD_START_TO_CORRECT/i.test(message)) return "ไม่พบช่วงทำงานล่าสุดที่แก้วันเริ่มได้ กรุณารีเฟรชข้อมูล";
  if (/INVALID_PERIOD_START_CORRECTION/i.test(message)) return "กรุณาเลือกวันเริ่มใหม่ที่ต่างจากวันเดิม";
  const periodOverlapEnd = message.match(/PERIOD_START_OVERLAPS_PREVIOUS:([0-9]{4}-[0-9]{2}-[0-9]{2})/)?.[1];
  if (periodOverlapEnd) return `วันเริ่มใหม่ต้องหลังช่วงก่อนหน้าซึ่งสิ้นสุด ${periodOverlapEnd}`;
  if (/PERIOD_START_CORRECTION_DATE_IN_FUTURE/i.test(message)) return "วันเริ่มใหม่ต้องไม่เกินวันนี้";
  const correctionEnd = message.match(/PERIOD_START_CORRECTION_AFTER_END:([0-9]{4}-[0-9]{2}-[0-9]{2})/)?.[1];
  if (correctionEnd) return `วันเริ่มใหม่ต้องไม่เกินวันสิ้นสุดช่วง ${correctionEnd}`;
  if (/FUTURE_ATTENDANCE_DATE/i.test(message)) return "ช่วงวันที่แก้ปฏิทินต้องไม่เกินวันปัจจุบัน";
  if (/ACTIVE_PERIOD_ALREADY_OPEN/i.test(message)) return "พนักงานคนนี้มีช่วงทำงานที่เปิดอยู่แล้ว กรุณารีเฟรชข้อมูล";
  if (/NO_OPEN_ACTIVE_PERIOD/i.test(message)) return "ไม่พบช่วงทำงานที่เปิดอยู่ หรือวันที่มีผลไม่ต่อเนื่องกับช่วงเดิม";
  if (/NO_PENDING_PERIOD_ACTION/i.test(message)) return "ไม่พบกำหนดการรอมีผล กรุณารีเฟรชข้อมูล";
  if (/DATE_OUTSIDE_ACTIVE_PERIOD/i.test(message)) return "ช่วงวันที่อยู่นอกช่วงทำงานของพนักงาน กรุณาเปิดหรือกลับเข้าทำงานก่อน";
  if (/PRIMARY_BRANCH_REQUIRED/i.test(message)) return "พนักงานบางคนไม่มีสาขาหลักที่ใช้งานอยู่ กรุณาตั้งค่าสาขาหลักก่อน";
  if (/DESCRIPTION_REQUIRED/i.test(message)) return "กรุณาระบุรายละเอียดหนี้";
  if (/INVALID_WAGE_PRECISION|INVALID_WAGE/i.test(message)) return "ค่าแรงต้องเป็น 0 ขึ้นไปและมีทศนิยมไม่เกิน 4 ตำแหน่ง";
  if (/INVALID_AMOUNT/i.test(message)) return "จำนวนเงินต้องมากกว่า 0";
  if (/INVALID_ADJUSTMENT_TARGET/i.test(message)) return "ยอดเบิกใหม่ต้องเป็น 0 ขึ้นไปและมีทศนิยมไม่เกิน 2 ตำแหน่ง";
  if (/WITHDRAWAL_NOT_REPORT_LOCKED/i.test(message)) return "ปรับยอดได้เฉพาะรายการเบิกที่ถูกล็อกโดยรายงานแล้ว";
  if (/ADJUSTMENT_BRANCH_REQUIRED/i.test(message)) return "กรุณาเลือกสาขาที่จะรับหรือจ่ายผลต่าง";
  if (/ADJUSTMENT_PENDING_EXISTS/i.test(message)) return "รายการเบิกนี้มีคำขอปรับยอดรออนุมัติอยู่แล้ว";
  if (/ADJUSTMENT_NO_OP/i.test(message)) return "ยอดเบิกใหม่ต้องต่างจากยอดปัจจุบัน";
  if (/ADJUSTMENT_STALE/i.test(message)) return "ยอดเบิกปัจจุบันเปลี่ยนแล้ว กรุณารีเฟรชและตรวจยอดใหม่";
  const adjustmentFloor = message.match(/ADJUSTMENT_BELOW_CLOSED_FLOOR:([0-9.]+)/i)?.[1];
  if (adjustmentFloor) return `ยอดเบิกใหม่ต้องไม่น้อยกว่ายอดที่ปิดสลิปแล้ว ${adjustmentFloor} บาท`;
  if (/INVALID_ATTENDANCE_SELECTIONS/i.test(message)) return "ข้อมูลข้อยกเว้นวันทำงานไม่ถูกต้อง";
  if (/INVALID_MONTH/i.test(message)) return "เดือนไม่ถูกต้องหรือเป็นเดือนในอนาคต";
  if (/Expense location.*access denied|New expense location access denied/i.test(message)) return "คุณไม่มีสิทธิ์ดูแลสาขาค่าใช้จ่ายที่เลือก";
  if (/Expense location is not valid/i.test(message)) return "รายการนี้ไม่ต้องเลือกสาขาค่าใช้จ่าย";
  if (/already been decided/i.test(message)) return "รายการนี้ถูกตัดสินแล้ว กรุณารีเฟรชข้อมูล";
  if (/Forbidden/i.test(message)) return "คุณไม่มีสิทธิ์ทำรายการนี้";
  return "ไม่สามารถทำรายการได้ กรุณาลองใหม่";
}
