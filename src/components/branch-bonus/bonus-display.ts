export const bonusNumber = (value: number | null | undefined, decimals = 2) => value == null ? "—" : value.toLocaleString("th-TH", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
export const metricLabels = { burden: "ภาระดำเนินงานต่อยอดซื้อ", loss: "น้ำหนักลดลง", counts: "จำนวนรายการนับเงิน", age: "อายุยาง" };
export const metricUnits = { burden: "%", loss: "%", counts: "ใบ", age: "วัน" };
export const metricHelp = {
  burden: "เป้าคือสัดส่วนค่าใช้จ่ายที่ยอมรับได้ต่อยอดซื้อ เช่น 1.20% = ค่าใช้จ่าย 1.20 บาทต่อยอดซื้อ 100 บาท ค่าจริงยิ่งต่ำกว่าเป้ายิ่งดี",
  loss: "เป้าคือน้ำหนักลดลงที่ยอมรับได้ เช่น 2.00% = ลดลง 2 กก. ต่อน้ำหนักต้นทาง 100 กก. ค่าจริงยิ่งต่ำกว่าเป้ายิ่งดี",
  counts: "เป้าวันละ 1 ใบ รวมวันเริ่มและวันสิ้นสุด เทียบกับจำนวนใบนับเงินที่สำเร็จจริง ยิ่งมากกว่าเป้ายิ่งดี",
  age: "เป้าคืออายุเฉลี่ยยาง ณ ตรวจสอบ REX หน่วยวัน ถ่วงตามน้ำหนักต้นทางก่อนลด อายุยิ่งมากกว่าเป้ายิ่งดี ใช้อายุประมาณได้พร้อมป้ายระบุ",
};
export const costLabels: Record<string, string> = { expense: "รายจ่ายทั่วไป", withdrawal: "เงินเบิก", payroll: "เงินเดือน", transport: "ค่าขนส่ง", work: "ค่าทำงานส่งออก", fee: "ค่าธรรมเนียมโอน" };
export const primaryButton = "focus-ring min-h-11 rounded-lg bg-leaf px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";
export const secondaryButton = "focus-ring min-h-11 rounded-lg border border-black/10 bg-white px-4 py-2 font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50";
