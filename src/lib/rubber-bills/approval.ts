export function assertOfflineRubberBillPriceAllowed(
  prices: number[],
  configuredPrice: number | null | undefined,
  isOnline: boolean
) {
  if (
    !isOnline &&
    configuredPrice != null &&
    prices.some((price) => price !== configuredPrice)
  ) {
    throw new Error("ราคาบิลไม่ตรงกับราคาที่กำหนด ต้องออนไลน์เพื่อส่งคำขออนุมัติ");
  }
}
