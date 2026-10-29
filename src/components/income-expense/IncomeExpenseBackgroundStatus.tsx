import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertDialog } from "@/components/shared/AlertDialog";
import { authFetch } from "@/lib/auth-fetch";
import { incomeExpenseNotices, dismissIncomeExpenseNotice } from "@/lib/income-expense/background-idb";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

export function IncomeExpenseBackgroundNotices({ ownerUserId, locationId }: { ownerUserId: string; locationId: string }) {
  const online = useOnlineStatus();
  const [dismissError, setDismissError] = useState<string | null>(null);
  const client = useQueryClient();
  const key = ["incomeExpenseBackgroundNotices", ownerUserId, locationId];
  const notices = useQuery({ queryKey: key, enabled: online, queryFn: async () => {
    const stored = await incomeExpenseNotices(ownerUserId, locationId);
    const visible = [];
    for (const item of stored) {
      const response = await authFetch(`/api/lanflow/income-expense/background?${new URLSearchParams({ serverId: item.serverId, locationId })}`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
      if (!response.ok) continue;
      const context = await response.json();
      if (context.actorUserId === ownerUserId) visible.push(item);
    }
    return visible;
  } });
  if (!online || notices.isFetching || !notices.data?.length) return null;
  return <div className="space-y-2 text-pretty text-sm" role="status">
    {dismissError && <p role="alert" className="text-red-700">{dismissError}</p>}
    {notices.data.map((notice) => <div key={notice.commandId} className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p><span className="font-semibold tabular-nums">{notice.number}</span> — {notice.message}</p>
      <button type="button" className="focus-ring shrink-0 rounded px-2 py-1 underline" onClick={async () => {
        try {
          await dismissIncomeExpenseNotice(notice);
          setDismissError(null);
          await client.invalidateQueries({ queryKey: key });
        } catch { setDismissError("ยังบันทึกการรับทราบไม่ได้ กรุณาลองอีกครั้ง"); }
      }}>รับทราบ</button>
    </div>)}
  </div>;
}

export function IncomeExpenseBackgroundDelete({ number, onConfirm, onClose, discard = false }: {
  number: string; onConfirm: () => Promise<void>; onClose: () => void; discard?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  return <AlertDialog open title={discard ? "ทิ้งรายการค้าง" : "ยืนยันลบรายการ"}
    description={discard ? `ทิ้งงานค้าง ${number} จากเครื่องนี้ โดยไม่เปลี่ยนข้อมูลบนระบบกลาง ใช่ไหม?` : `ลบรายการ ${number} ใช่ไหม? ระบบจะส่งคำขอเบื้องหลัง และขออนุมัติตามกติกาปัจจุบัน`}
    confirmLabel={discard ? "ทิ้งรายการค้าง" : "ส่งคำขอลบ"} busy={busy} onCancel={onClose} onConfirm={() => {
      if (submitting.current) return;
      submitting.current = true;
      setBusy(true); setError(null);
      void onConfirm().then(onClose).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "รับคำขอลบไม่สำเร็จ"))
        .finally(() => { submitting.current = false; setBusy(false); });
    }}>
    {error && <p role="alert" className="text-pretty text-sm text-red-700">{error}</p>}
  </AlertDialog>;
}
