"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch, assertApiResponse } from "@/lib/auth-fetch";
import { isIssuerPage, type IssuerRow } from "@/lib/rubber-bills/issuer-management-contract";
import { ModalShell } from "@/components/shared/ModalShell";
import { TablePagination } from "@/components/shared/TablePagination";
import type { Location } from "@/types";

const endpoint = "/api/lanflow/admin/rubber-bill-issuers";
const time = (v: string) => new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" }).format(new Date(v));
export function RubberBillIssuers({ ownerUserId, locations }: { ownerUserId: string; locations: Location[] }) {
  const client = useQueryClient(), lock = useRef(false);
  const [location, setLocation] = useState(""), [status, setStatus] = useState("all");
  const [draft, setDraft] = useState(""), [search, setSearch] = useState(""), [page, setPage] = useState(1);
  const [target, setTarget] = useState<IssuerRow | null>(null), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const query = useQuery({ queryKey: ["rubberBillIssuers", ownerUserId, location, status, search, page],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ search, status, offset: String((page - 1) * 20) });
      if (location) params.set("locationId", location);
      const response = await authFetch(`${endpoint}?${params}`, { cache: "no-store", signal });
      await assertApiResponse(response);
      const result: unknown = await response.json();
      if (!isIssuerPage(result)) throw new Error("รูปแบบทะเบียนเครื่องไม่ถูกต้อง");
      return result;
    } });
  async function retire() {
    if (!target || lock.current) return;
    lock.current = true; setSaving(true); setError("");
    try {
      const response = await authFetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: target.id }) });
      await assertApiResponse(response);
      const result = await response.json();
      if (result?.id !== target.id || result?.retired !== true) throw new Error("ยังยืนยันผลไม่ได้ กรุณาโหลดทะเบียนแล้วตรวจอีกครั้ง");
      setTarget(null); await client.invalidateQueries({ queryKey: ["rubberBillIssuers", ownerUserId] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "เลิกใช้งานรหัสไม่สำเร็จ"); }
    finally { lock.current = false; setSaving(false); }
  }
  return <section className="space-y-4 rounded-md border border-black/10 bg-white p-4 shadow-panel">
    <div><h3 className="text-balance text-lg font-bold">เครื่องออกบิล</h3><p className="text-pretty text-sm text-ink/60">หนึ่งเบราว์เซอร์/โปรไฟล์ต่อรหัส · เวลาติดต่อล่าสุดไม่ใช่สถานะออนไลน์ปัจจุบัน</p></div>
    <form onSubmit={event => { event.preventDefault(); setSearch(draft.trim()); setPage(1); }} className="flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-sm font-semibold">สาขา<select aria-label="กรองสาขาเครื่องออกบิล" value={location} onChange={e => { setLocation(e.target.value); setPage(1); }} className="focus-ring h-10 rounded-md border border-black/15 px-3"><option value="">ทุกสาขา</option>{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm font-semibold">สถานะ<select aria-label="กรองสถานะรหัสเครื่อง" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className="focus-ring h-10 rounded-md border border-black/15 px-3"><option value="all">ทั้งหมด</option><option value="active">ใช้งาน</option><option value="retired">เลิกใช้งาน</option></select></label>
      <label className="grid gap-1 text-sm font-semibold">ค้นหา<input maxLength={160} value={draft} onChange={e => setDraft(e.target.value)} className="focus-ring h-10 rounded-md border border-black/15 px-3" placeholder="รหัส เบราว์เซอร์ หรือผู้ใช้" /></label>
      <button type="submit" className="focus-ring h-10 rounded-md bg-leaf px-4 text-sm font-semibold text-white">ค้นหา</button>
      <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching} className="focus-ring h-10 rounded-md border border-black/15 px-3 text-sm disabled:opacity-50">โหลดใหม่</button>
    </form>
    {query.isError && <p role="alert" className="text-pretty text-sm text-danger">{query.error.message} <button type="button" onClick={() => void query.refetch()} className="focus-ring underline">ลองใหม่</button></p>}
    <p className="text-xs text-ink/60 sm:hidden">เลื่อนตารางด้านข้างเพื่อดูข้อมูลและจัดการรหัสเครื่อง</p>
    <div className="overflow-x-auto"><table className="w-full min-w-max text-left text-sm"><thead><tr className="border-b border-black/10 text-ink/65">{["รหัส / สาขา", "เบราว์เซอร์ / ระบบ", "ผู้ใช้ล่าสุด", "ลงทะเบียน / ติดต่อล่าสุด", "สถานะ / จัดการ"].map(label => <th key={label} scope="col" className="p-3">{label}</th>)}</tr></thead>
      <tbody className="divide-y divide-black/5">{query.isPending ? <tr><td colSpan={5} className="p-6" role="status">กำลังโหลดทะเบียนเครื่อง...</td></tr> : query.data?.rows.length ? query.data.rows.map(row => <tr key={row.id}>
        <td className="p-3"><p className="font-semibold tabular-nums">{row.code}</p><p className="text-ink/60">{row.locationName ?? "ไม่พบสาขา"}</p></td>
        <td className="p-3">{row.browser}<p className="text-ink/60">{row.platform}</p></td><td className="p-3">{row.lastUserName ?? "ไม่ระบุ"}</td>
        <td className="p-3 tabular-nums">{time(row.createdAt)}<p className="text-ink/60">{time(row.lastSeenAt)}</p></td>
        <td className="p-3">{row.retiredAt ? <><span className="text-ink/60">เลิกใช้งานแล้ว</span><p className="text-pretty text-xs text-ink/60">{row.retiredByName ?? "ผู้ดูแล"} · {time(row.retiredAt)}</p></> : <button type="button" onClick={() => { setError(""); setTarget(row); }} className="focus-ring h-10 rounded-md border border-black/15 px-3 font-semibold">เลิกใช้งาน</button>}</td>
      </tr>) : <tr><td colSpan={5} className="p-6 text-center text-ink/60">ไม่พบทะเบียนเครื่อง <button type="button" onClick={() => { setLocation(""); setStatus("all"); setSearch(""); setDraft(""); setPage(1); void query.refetch(); }} className="focus-ring underline">ดูทั้งหมด</button></td></tr>}</tbody></table></div>
    <TablePagination totalItems={query.data?.total ?? 0} page={page} pageSize={20} onPageChange={setPage} />
    {target && <ModalShell nativeModal renderInPortal closeOnEscape role="alertdialog" title={`เลิกใช้งานรหัส ${target.code}?`} closeDisabled={saving} onClose={() => setTarget(null)}>
      <p className="mb-3 text-pretty text-sm">{target.locationName} · {target.browser} · {target.platform}</p>
      <p className="mb-4 text-pretty text-sm text-ink/65">บิลเดิมและงานค้างยังอยู่ เครื่องจะรับรหัสใหม่เมื่อกลับมาออนไลน์ การเลิกใช้รหัสไม่ระงับการเข้าสู่ระบบ</p>
      <div className="flex gap-2"><button type="button" disabled={saving} onClick={() => void retire()} className="focus-ring h-10 rounded-md bg-leaf px-4 font-semibold text-white disabled:opacity-50">{saving ? "กำลังดำเนินการ..." : "ยืนยันเลิกใช้งาน"}</button><button type="button" disabled={saving} onClick={() => setTarget(null)} className="focus-ring h-10 rounded-md border border-black/15 px-4 disabled:opacity-50">ยกเลิก</button></div>
      {error && <p role="alert" className="mt-3 text-pretty text-sm text-danger">{error}</p>}
    </ModalShell>}
  </section>;
}
