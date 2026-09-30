import { formatCurrency } from "@/lib/format";
import { TIME_TRACKING_OFFLINE_MESSAGE } from "../policy";

export function EmployeeFinancialSummary({ data, managed, canManageTime, online, onOpenDebt }: {
  data: any; managed: boolean; canManageTime: boolean; online: boolean; onOpenDebt: () => void;
}) {
  return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white p-4 rounded-xl border border-black/10 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="font-semibold text-ink/70">สถานะการลงเวลา</h3>
            <span className="mt-2 inline-flex rounded-md bg-river/10 px-2 py-1 text-sm font-bold text-river">วันเต็มอัตโนมัติ</span>
            <p className="mt-3 text-pretty text-sm text-ink/60">ไม่ต้องเริ่มหรือหยุดนับเวลา ระบบคำนวณจากช่วงทำงานและปฏิทิน</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-black/10 shadow-sm flex flex-col justify-between overflow-x-auto">
          <div>
            <h3 className="font-semibold text-ink/70">ยอดเงินคงเหลือ</h3>
            <p className={`text-2xl font-bold mt-2 ${data?.wageInfo?.remainingBalance < 0 ? 'text-clay' : 'text-leaf'}`}>
              {formatCurrency(data?.wageInfo?.remainingBalance || 0)}
            </p>
            <p className="text-xs text-ink/50 mt-1">
              (จำนวนวันทำงาน {data?.wageInfo?.totalDays?.toFixed(2) || 0} วัน)
            </p>
          </div>

          <div className="mt-4 pt-3 border-t border-black/5 flex flex-col gap-3">
            <div>
              <h3 className="text-sm font-semibold text-ink/70">ยอดหนี้สินค้างชำระ</h3>
              <p className="text-lg font-bold text-clay mt-1">
                {formatCurrency(data?.wageInfo?.totalDebt || 0)}
              </p>
            </div>

            {managed && canManageTime && (
              <button
                onClick={() => {
                  if (!online) {
                    alert(TIME_TRACKING_OFFLINE_MESSAGE);
                    return;
                  }
                  onOpenDebt();
                }}
                disabled={!online}
                title={online ? undefined : TIME_TRACKING_OFFLINE_MESSAGE}
                className="w-full rounded-lg bg-clay py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-clay/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                สร้างหนี้สินเพิ่ม
              </button>
            )}
          </div>
        </div>
      </div>
  );
}

