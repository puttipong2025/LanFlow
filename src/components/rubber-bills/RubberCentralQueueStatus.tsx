"use client";

import { useDeferredValue, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ModalShell } from "@/components/shared/ModalShell";
import { AlertDialog } from "@/components/shared/AlertDialog";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { authFetch } from "@/lib/auth-fetch";
import { getPendingEvents } from "@/lib/idb-queue";
import { cn } from "@/lib/cn";
import { isRubberQueueRow, rubberQueueMessage, type RubberQueueRow } from "@/lib/rubber-bills/central-queue-contract";
import { RUBBER_QUEUE_ENDPOINT, isCentralRubberEvent } from "@/lib/rubber-bills/central-sync";
import { rubberBillFromSyncEvent } from "@/lib/rubber-bills/local-feed";
import type { RubberBill } from "@/types";
import { invalidateMoneyFlowLocation } from "@/lib/money-flow/invalidation";
import { acknowledgeRubberQueueNotice, loadRubberQueueNoticeAcks, rubberQueueNoticeKey } from "@/lib/rubber-bills/central-notices";

type Page = { rows: RubberQueueRow[]; notices?: RubberQueueRow[]; counts: { pending: number; attention: number; revision?: string } };
const actions = { create: "สร้างบิล", update: "แก้ไขบิล", delete: "ลบบิล", approve: "อนุมัติคำขอ", cancel: "ลบคำขออนุมัติ" };
const button = "focus-ring rounded-md border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-ink disabled:opacity-50";

export function RubberCentralQueueStatus({ ownerUserId, locationId, locationName, onCorrect }: {
  ownerUserId: string; locationId: string; locationName: string; onCorrect: (bill: RubberBill) => void;
}) {
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const [open, setOpen] = useState(false);
  const [noticeAcks, setNoticeAcks] = useState(() => loadRubberQueueNoticeAcks(ownerUserId, locationId));
  const [history, setHistory] = useState(false);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const seenRevision = useRef<string | null>(null);
  const [cursors, setCursors] = useState<{ before: string; beforeId: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retiring, setRetiring] = useState<RubberQueueRow | null>(null);
  const cursor = cursors.at(-1);
  const query = useQuery({
    queryKey: ["rubberCentralQueue", ownerUserId, locationId, history, cursor, deferredSearch],
    enabled: online,
    refetchInterval: online ? 10_000 : false,
    queryFn: async ({ signal }): Promise<Page> => {
      const params = new URLSearchParams({ locationId, history: String(history), search: deferredSearch, ...cursor });
      const response = await authFetch(`${RUBBER_QUEUE_ENDPOINT}?${params}`, { cache: "no-store", signal }, { background: true });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data?.rows) || data.rows.length > 50
        || !data.rows.every((row: unknown) => isRubberQueueRow(row) && row.locationId === locationId)
        || !Number.isSafeInteger(data.counts?.pending) || data.counts.pending < 0
        || (data.notices !== undefined && (!Array.isArray(data.notices)
          || !data.notices.every((row: unknown) => isRubberQueueRow(row) && row.locationId === locationId && row.state === "done")))) throw new Error("ยังโหลดคิวกลางไม่ได้ กรุณาลองใหม่");
      return data;
    },
  });
  useEffect(() => {
    if (!online || !query.data) return;
    const revision = query.data.counts.revision ?? JSON.stringify(query.data);
    if (seenRevision.current === revision) return;
    seenRevision.current = revision;
    void invalidateMoneyFlowLocation(queryClient, { ownerUserId, locationId });
  }, [online, query.data, queryClient, ownerUserId, locationId]);
  const local = useQuery({
    queryKey: ["rubberCentralQueue", ownerUserId, locationId, "local"],
    networkMode: "always",
    refetchInterval: 10_000,
    queryFn: () => getPendingEvents({ entity: "rubber_bills", ownerUserId, locationId }),
  });
  const rows = query.data?.rows ?? [];
  const localOnly = (local.data ?? []).filter(event => isCentralRubberEvent(event)
    && !(event as typeof event & { centralAccepted?: boolean }).centralAccepted
    && !rows.some(row => row.commandId === event.payload.commandId));
  const notices = (query.data?.notices ?? []).filter(row => !noticeAcks.includes(rubberQueueNoticeKey(row)));

  async function manage(row: RubberQueueRow, action: "retry" | "retire") {
    setBusy(row.commandId); setError(null);
    try {
      const response = await authFetch(RUBBER_QUEUE_ENDPOINT, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commandId: row.commandId, version: row.version, action }) }, { background: true });
      const result: unknown = await response.json();
      if (!response.ok || !isRubberQueueRow(result) || result.commandId !== row.commandId) throw new Error("คิวเปลี่ยนหรือยังทำรายการไม่ได้ กรุณาโหลดใหม่");
      setRetiring(null);
      await queryClient.invalidateQueries({ queryKey: ["rubberCentralQueue", ownerUserId, locationId] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ทำรายการไม่สำเร็จ"); }
    finally { setBusy(null); }
  }

  async function correct(row: RubberQueueRow) {
    setBusy(row.commandId); setError(null);
    try {
      const params = new URLSearchParams({ locationId, draftCommandId: row.commandId });
      const response = await authFetch(`${RUBBER_QUEUE_ENDPOINT}?${params}`, { cache: "no-store" }, { background: true });
      const data = await response.json();
      if (!response.ok || data?.commandId !== row.commandId || data.locationId !== locationId
        || data.clientTempId !== row.clientTempId || !data.payload) throw new Error("ร่างเปลี่ยนแล้ว กรุณาโหลดคิวใหม่");
      if (data.payload.inputMethod === "ocr" && data.actorUserId !== ownerUserId) throw new Error("รูป OCR ผูกกับผู้ส่งเดิม ให้ผู้ส่งเดิมเปิดแก้ไขหรือเลือกรูปใหม่");
      const bill = rubberBillFromSyncEvent({ id: row.clientTempId, entity: "rubber_bills", ownerUserId, locationId,
        operation: "create", payload: data.payload, timestamp: Date.parse(row.acceptedAt), status: "failed", failureHttpStatus: 400 }, ownerUserId);
      if (!bill) throw new Error("ยังเปิดร่างนี้ไม่ได้");
      setOpen(false); onCorrect({ ...bill, revisionNo: 0 });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "เปิดร่างไม่สำเร็จ"); }
    finally { setBusy(null); }
  }

  return <>
    <button type="button" className={cn(button, "tabular-nums")} onClick={() => setOpen(true)}>
      คิวซิงก์ {query.data?.counts.pending ?? ""}{localOnly.length > 0 ? ` · ในเครื่อง ${localOnly.length}` : ""}
    </button>
    {online && notices.map(row => <div key={rubberQueueNoticeKey(row)} role="status" className="flex items-center gap-2 rounded-md bg-amber-50 p-2 text-pretty text-sm text-amber-900">
      <span>{row.reference || "บิลยาง"}: {rubberQueueMessage(row)}</span>
      <button type="button" className={button} onClick={() => setNoticeAcks(keys => acknowledgeRubberQueueNotice(ownerUserId, locationId, keys, rubberQueueNoticeKey(row)))}>รับทราบ</button>
    </div>)}
    {open && <ModalShell nativeModal closeOnEscape title={`คิวซิงก์ — ${locationName}`} onClose={() => setOpen(false)} size="wide">
      <div className="space-y-4 text-pretty">
        <p className="text-sm text-muted">รายการที่ส่งถึงคิวกลางแล้ว ระบบทำต่อได้แม้ปิดหน้านี้ ทุกเครื่องที่มีสิทธิ์ในสาขาเห็นผลเดียวกัน</p>
        {query.dataUpdatedAt > 0 && <p className="text-xs tabular-nums text-muted">ตรวจคิวสำเร็จล่าสุด {new Date(query.dataUpdatedAt).toLocaleString("th-TH")}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={!history} className={cn(button, !history && "border-leaf bg-leaf text-white")} onClick={() => { setHistory(false); setCursors([]); }}>รอดำเนินการ</button>
          <button type="button" aria-pressed={history} className={cn(button, history && "border-leaf bg-leaf text-white")} onClick={() => { setHistory(true); setCursors([]); }}>ผลดำเนินการ</button>
          <button type="button" className={button} disabled={!online || query.isFetching} onClick={() => void query.refetch()}>โหลดใหม่</button>
        </div>
        <label className="grid gap-1 text-sm font-semibold">ค้นหาเลขบิลในคิว
          <input className="focus-ring rounded-md border border-black/10 px-3 py-2 font-normal" maxLength={512} value={search}
            onChange={event => { setSearch(event.target.value); setCursors([]); }} />
        </label>
        {!online && <p role="status" className="text-sm">ออฟไลน์ — รายการที่ยังส่งไม่ถึงคิวกลางจะเก็บไว้ในเครื่อง และส่งต่อเมื่อเชื่อมต่อได้</p>}
        {(error || query.error) && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{error || query.error?.message}</p>}
        {query.isPending && online && <div aria-label="กำลังโหลดคิว" className="h-24 rounded-md bg-slate-100" />}
        {!history && localOnly.length > 0 && <div className="rounded-md border border-black/10 p-3 text-sm tabular-nums">รอส่งหรือรอยืนยันจากเครื่องนี้ {localOnly.length} รายการ รายการที่ยังไม่เคยส่งจะปรากฏบนเครื่องอื่นเมื่อถึงคิวกลาง</div>}
        <ul className="divide-y divide-black/10">
          {rows.map(row => <li key={row.commandId} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div className="min-w-0 space-y-1">
              <p className="font-semibold">{actions[row.action]} <span className="font-normal tabular-nums">{row.reference || row.clientTempId.slice(0, 24)}</span></p>
              <p className={cn("text-sm", row.errorCode ? "text-amber-800" : "text-muted")}>{rubberQueueMessage(row)}</p>
              <p className="text-xs tabular-nums text-muted">รับเมื่อ {new Date(row.acceptedAt).toLocaleString("th-TH")} · ลองแล้ว {row.attempts} ครั้ง</p>
            </div>
            {row.state !== "done" && <div className="flex flex-wrap gap-2">
              {row.state === "correction_required" ? <button className={button} disabled={!online || busy !== null} onClick={() => void correct(row)}>แก้ไขร่าง</button>
                : <button className={button} disabled={!online || busy !== null} onClick={() => void manage(row, "retry")}>ลองใหม่</button>}
              {row.canRetire && <button className={cn(button, "text-red-700")} disabled={!online || busy !== null} onClick={() => setRetiring(row)}>ยกเลิกงานบัญชีที่ปิดแล้ว</button>}
            </div>}
          </li>)}
        </ul>
        {!query.isPending && rows.length === 0 && <p className="text-sm text-muted">{history ? "ยังไม่มีผลดำเนินการ" : "ไม่มีงานรอในคิวกลาง"} กดโหลดใหม่เพื่อตรวจล่าสุดได้</p>}
        <div className="flex gap-2">
          {cursors.length > 0 && <button className={button} onClick={() => setCursors(value => value.slice(0, -1))}>ก่อนหน้า</button>}
          {rows.length === 50 && <button className={button} onClick={() => { const last = rows.at(-1)!; setCursors(value => [...value, { before: last.acceptedAt, beforeId: last.commandId }]); }}>ถัดไป</button>}
        </div>
      </div>
    </ModalShell>}
    <AlertDialog open={retiring !== null} title="ยกเลิกงานของบัญชีที่ปิดแล้ว" description="ยกเลิกเฉพาะคำสั่งที่ยังไม่สำเร็จ บิลบนเซิร์ฟเวอร์และงานอื่นยังคงอยู่ ระบบจะบันทึกผู้ยกเลิกและเวลา"
      confirmLabel="ยืนยันยกเลิกงาน" busy={busy !== null} confirmClassName="bg-red-700 text-white" onCancel={() => setRetiring(null)}
      onConfirm={() => { if (retiring) void manage(retiring, "retire"); }}>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    </AlertDialog>
  </>;
}
