export function RubberBillPriceReference({
  centralPrice,
  priceAllowance,
  effectivePriceCap,
  exceedsEffectivePriceCap,
}: {
  centralPrice?: number;
  priceAllowance?: number;
  effectivePriceCap?: number;
  exceedsEffectivePriceCap: boolean;
}) {
  if (centralPrice == null || priceAllowance == null || effectivePriceCap == null) return null;
  return (
    <div className={`mb-3 rounded-md border px-3 py-2 text-sm ${exceedsEffectivePriceCap ? "border-amber-300 bg-amber-50 text-amber-900" : "border-leaf/20 bg-leaf/5 text-leaf"}`}>
      <p className="text-pretty tabular-nums">ราคากลาง {centralPrice.toFixed(2)} · ซื้อเกินได้ {priceAllowance.toFixed(2)} · ราคาสูงสุด {effectivePriceCap.toFixed(2)} บาท/กก.</p>
      {exceedsEffectivePriceCap && <p className="mt-1 text-pretty">มีราคาสูงกว่าเพดาน บิลนี้จะถูกส่งขออนุมัติ</p>}
    </div>
  );
}
