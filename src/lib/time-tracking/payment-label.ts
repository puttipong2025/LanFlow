function formatMoney(value: number) {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function paymentAllocationSourceLabel({ channel, transferAmount, sourceAmount, locationName }: {
  channel: string | null | undefined;
  transferAmount: number;
  sourceAmount: number;
  locationName?: string | null;
}) {
  if (channel === "outside_system") return "จ่ายนอกระบบ";
  if (channel !== "branch_and_transfer") return null;
  const branchAmount = sourceAmount - transferAmount;
  if (transferAmount === 0) return `สาขาจ่ายทั้งหมด ${formatMoney(branchAmount)} บาท — ${locationName || "สาขา"}`;
  if (branchAmount === 0) return `โอนเงินทั้งหมด ${formatMoney(transferAmount)} บาท`;
  return `โอน ${formatMoney(transferAmount)} บาท + ${locationName || "สาขา"} จ่ายส่วนต่าง ${formatMoney(branchAmount)} บาท`;
}
