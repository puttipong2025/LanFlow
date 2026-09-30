import { formatPayrollCurrency } from "@/lib/time-tracking/format";
import { TIME_TRACKING_OFFLINE_MESSAGE } from "../policy";

export function EmployeeSlipList({ slips, online, onPreview }: {
  slips: any[] | undefined; online: boolean; onPreview: (id: string) => void;
}) {
  return (
      <div className="bg-white p-4 rounded-xl border border-black/10 shadow-sm">
        <h3 className="font-semibold text-ink/70 mb-4">สลิปเงินเดือน</h3>
        {!slips?.length ? (
          <p className="text-sm text-ink/50">ยังไม่มีสลิปเงินเดือน</p>
        ) : (
          <ul className="divide-y divide-black/5">
            {slips.map((slip: any) => (
              <li key={slip.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">เดือน {slip.month} · สุทธิ {formatPayrollCurrency(slip.net_pay)}</p>
                  <p className="text-xs text-ink/55">ขั้นต้น {formatPayrollCurrency(slip.gross_pay)} · หัก {formatPayrollCurrency(slip.total_deductions)} · {slip.status}</p>
                </div>
                {!slip.cancelled_at && (slip.status === 'PENDING' || slip.status === 'APPROVED') && (
                  <button
                    type="button"
                    onClick={() => onPreview(slip.id)}
                    disabled={!online}
                    title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE}
                    className="focus-ring self-start rounded-md bg-river px-3 py-1.5 text-sm font-semibold text-white hover:bg-river/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    ดูสลิป
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
  );
}
