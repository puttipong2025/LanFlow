import { useState } from "react";
import { Settings2 } from "lucide-react";
import { ModalShell } from "@/components/shared/ModalShell";
import type { TimePayrollSettingsDto } from "@/lib/time-tracking/attendance-contract";

export function TimePayrollConfigPanel({
  settings,
  canConfigure,
  online,
  saving,
  onSave,
}: {
  settings: TimePayrollSettingsDto;
  canConfigure: boolean;
  online: boolean;
  saving?: boolean;
  onSave: (time: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(settings.pendingWorkdayEndTime ?? settings.workdayEndTime);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!/^\d{2}:\d{2}$/.test(time)) {
      setError("กรุณาระบุเวลาในรูปแบบ ชั่วโมง:นาที");
      return;
    }
    if (await onSave(time)) setOpen(false);
    else setError("บันทึกการตั้งค่าไม่สำเร็จ กรุณาลองใหม่");
  }

  return (
    <>
      <section className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-balance font-bold text-ink"><Settings2 size={18} aria-hidden="true" />เวลาสิ้นสุดวันทำงาน</h3>
            <p className="mt-1 text-pretty text-sm text-ink/70">ปัจจุบัน {settings.workdayEndTime} น.</p>
            {settings.pendingWorkdayEndTime && <p className="mt-1 text-pretty text-xs text-amber">รอใช้ {settings.pendingWorkdayEndTime} น. ตั้งแต่ {settings.pendingEffectiveDate}</p>}
          </div>
          {canConfigure ? <button type="button" onClick={() => { setTime(settings.pendingWorkdayEndTime ?? settings.workdayEndTime); setOpen(true); }} disabled={!online} title={online ? "ตั้งค่าเวลาสิ้นสุดวันทำงาน" : "เวลาและเงินเดือนใช้ได้เมื่อออนไลน์เท่านั้น"} aria-label="ตั้งค่าเวลาสิ้นสุดวันทำงาน" className="focus-ring inline-flex size-10 items-center justify-center rounded-md bg-river text-white hover:bg-river/90 disabled:cursor-not-allowed disabled:opacity-50"><Settings2 size={18} aria-hidden="true" /></button> : <span className="text-xs text-ink/55">ดูได้เท่านั้น</span>}
        </div>
      </section>
      {open && (
        <ModalShell title="ตั้งค่าเวลาสิ้นสุดวันทำงาน" subtitle="การเปลี่ยนแปลงจะมีผลในวันถัดไป" onClose={() => setOpen(false)} nativeModal closeOnEscape size="compact" closeDisabled={saving}>
          <form onSubmit={(event) => void submit(event)} className="space-y-4" aria-busy={saving}>
            <label className="grid gap-1 text-sm font-semibold text-ink">เวลาใหม่
              <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="focus-ring h-10 rounded-md border border-black/15 px-3" required aria-invalid={Boolean(error)} aria-describedby={error ? "time-payroll-config-error" : undefined} />
            </label>
            {error && <p id="time-payroll-config-error" role="alert" className="text-sm font-semibold text-danger">{error}</p>}
            <button type="submit" disabled={saving || !online} className="focus-ring h-10 rounded-md bg-commit px-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{saving ? "กำลังบันทึก..." : "บันทึกให้มีผลวันถัดไป"}</button>
          </form>
        </ModalShell>
      )}
    </>
  );
}

