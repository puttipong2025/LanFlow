"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Eye, Layers3, Loader2, Plus, Upload } from "lucide-react";
import type { Customer, MoneyTransfer, MoneyTransferSlip } from "@/types";
import { authFetch } from "@/lib/auth-fetch";
import { normalizeBangkokDateTime } from "@/lib/bangkok-date";
import { formatCurrency } from "@/lib/format";
import { usePaymentBundleCandidates, usePaymentBundleCustomerOptions, usePaymentBundleDetail, usePaymentBundleMutations } from "@/hooks/usePaymentBundles";
import { ModalShell } from "@/components/shared/ModalShell";
import { AlertDialog } from "@/components/shared/AlertDialog";
import { MoneyTransferSourceDetailsModal } from "./MoneyTransferSourceDetailsModal";
import { SlipRow, type OcrSlipResult } from "./SlipRow";
import { SlipValidationSummary } from "./SlipValidationSummary";
import { focusFirstSlipIssue, validateMoneyTransferSlips, type SlipValidationIssue } from "./slip-validation";

type BundleType = "customer" | "rubber_export_work";

export function PaymentBundleDialog({
  locationId, profileId, customers, online, initialBundle, onClose, onSaved,
}: {
  locationId: string;
  profileId: string;
  customers: Customer[];
  online: boolean;
  initialBundle?: MoneyTransfer | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [bundleType, setBundleType] = useState<BundleType>(initialBundle?.transferType === "rubber_export_work" ? "rubber_export_work" : "customer");
  const [customerId, setCustomerId] = useState(initialBundle?.customerId ?? "");
  const [accountNumber, setAccountNumber] = useState(initialBundle?.accountNumber ?? "");
  const [bundleId, setBundleId] = useState(initialBundle?.id ?? null);
  const [slips, setSlips] = useState<MoneyTransferSlip[]>(initialBundle?.slips ?? []);
  const [branchPaysRemaining, setBranchPaysRemaining] = useState(initialBundle?.transferStatus === "branch_and_transfer");
  const [issues, setIssues] = useState<SlipValidationIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmDissolve, setConfirmDissolve] = useState(false);
  const [sourceTransfer, setSourceTransfer] = useState<MoneyTransfer | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const selectedCustomer = customers.find((customer) => customer.id === customerId);
  const accounts = useMemo(() => [...(selectedCustomer?.bankAccounts ?? [])]
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)), [selectedCustomer]);
  const destinationAccount = accounts.find((account) => account.accountNumber === accountNumber) ?? accounts[0] ?? null;
  const customerOptions = usePaymentBundleCustomerOptions(locationId, !bundleId && online && bundleType === "customer");
  const candidates = usePaymentBundleCandidates({
    locationId, bundleType, customerId: customerId || null,
    enabled: !bundleId && online && (bundleType === "rubber_export_work" || Boolean(customerId)),
  });
  const detail = usePaymentBundleDetail(bundleId);
  const bundle = detail.data ?? initialBundle ?? null;
  const mutations = usePaymentBundleMutations(locationId, profileId);

  useEffect(() => {
    if (!detail.data) return;
    setSlips(detail.data.slips ?? []);
    setBranchPaysRemaining(detail.data.transferStatus === "branch_and_transfer");
  }, [detail.data]);

  useEffect(() => {
    if (!detail.data || !initialBundle?.matchedChildId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`bundle-child-${initialBundle.matchedChildId}`)?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [detail.data, initialBundle?.matchedChildId]);

  const paid = slips.reduce((total, slip) => total + Number(slip.amount || 0), 0);
  const summary = bundle?.bundleSummary;
  const remaining = Math.max(0, (summary?.amountDue ?? bundle?.netAmountToPay ?? 0) - paid);
  const busy = mutations.createPaymentBundle.isPending || mutations.savePaymentBundle.isPending
    || mutations.dissolvePaymentBundle.isPending || uploading;
  const canDissolve = Boolean(bundle && !bundle.reportLockNo && !bundle.bundleFrozenAt && slips.length === 0);
  const queryError = customerOptions.error ?? candidates.error ?? detail.error;
  const visibleError = error ?? (queryError instanceof Error ? queryError.message : null);

  const orderedCustomers = useMemo(() => customers.filter((customer) => customerOptions.data?.includes(customer.id))
    .sort((a, b) => a.mainName.localeCompare(b.mainName, "th")), [customers, customerOptions.data]);
  const minimumCount = bundleType === "customer" ? 2 : 1;
  const canCreate = online && !busy && !candidates.isFetching && !candidates.error
    && (candidates.data?.eligibleCount ?? 0) >= minimumCount;

  async function copy(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(message);
    } catch { setError("คัดลอกไม่สำเร็จ กรุณาลองใหม่"); }
  }

  async function createBundle() {
    if (!canCreate) return;
    setError(null);
    try {
      const created = await mutations.createPaymentBundle.mutateAsync({
        bundleType, customerId: customerId || null, accountNumber: destinationAccount?.accountNumber ?? null,
      });
      setBundleId(created.id);
      setNotice(`สร้างชุดรวม ${created.bundleSummary?.childCount ?? 0} รายการแล้ว`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "สร้างชุดรวมไม่สำเร็จ"); }
  }

  function addSlip() {
    setSlips((current) => [...current, {
      id: crypto.randomUUID(), inputMethod: "manual", amount: 0, referenceNumber: null,
      fee: 0, senderName: null, receiverName: null, transactionDate: null,
      slipImageUrl: null, sortOrder: current.length,
    }]);
  }

  async function readSlip(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const body = new FormData();
        body.append("image", file);
        const response = await authFetch("/api/lanflow/ocr-slip", { method: "POST", body });
        if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "อ่านสลิปไม่สำเร็จ");
        const result = await response.json() as OcrSlipResult;
        setSlips((current) => [...current, {
          id: crypto.randomUUID(), inputMethod: "ocr", amount: result.amount ?? 0,
          referenceNumber: result.reference_number, fee: result.fee ?? 0,
          senderName: null, receiverName: null,
          transactionDate: normalizeBangkokDateTime(result.transaction_date),
          slipImageUrl: null, sortOrder: current.length,
        }]);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "อ่านสลิปไม่สำเร็จ"); }
    finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function saveBundle() {
    if (!bundle) return;
    const nextIssues = validateMoneyTransferSlips(slips);
    setIssues(nextIssues);
    if (nextIssues.length) { focusFirstSlipIssue(nextIssues); return; }
    setError(null);
    try {
      await mutations.savePaymentBundle.mutateAsync({
        bundle: { ...bundle, slips: slips.map((slip, index) => ({ ...slip, sortOrder: index })) },
        branchPaysRemaining,
      });
      onSaved();
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "บันทึกชุดรวมไม่สำเร็จ"); }
  }

  async function dissolve() {
    if (!bundle) return;
    try {
      await mutations.dissolvePaymentBundle.mutateAsync(bundle);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ยุบชุดรวมไม่สำเร็จ"); }
  }

  return <>
    <ModalShell title={bundleId ? "รายละเอียดชุดจ่ายรวม" : "สร้างชุดจ่ายรวม"}
      subtitle="รวมรายการรอโอนและค้างจ่าย โดยเก็บรายการลูกและสลิปเดิมไว้"
      size="wide" closeOnEscape={!sourceTransfer} closeDisabled={busy} onClose={onClose}>
      <div className="space-y-4">
        {!bundleId ? <>
          <div className="flex gap-2" role="group" aria-label="ประเภทชุดรวม">
            {([['customer', 'โอนเงินลูกค้า'], ['rubber_export_work', 'ค่าทำงาน REX']] as const).map(([value, label]) =>
              <button key={value} type="button" aria-pressed={bundleType === value}
                onClick={() => { setBundleType(value); setCustomerId(""); setAccountNumber(""); }}
                className={`focus-ring h-10 rounded-md px-4 text-sm font-semibold text-white ${bundleType === value ? "bg-leaf" : "bg-actionSecondary"}`}>
                {label}
              </button>)}
          </div>
          {bundleType === "customer" && <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="mb-1 block text-sm font-semibold text-ink">ลูกค้า</span>
              <select value={customerId} onChange={(event) => { setCustomerId(event.target.value); setAccountNumber(""); }}
                className="focus-ring h-10 w-full rounded-md border border-black/15 bg-white px-3 text-sm">
                <option value="">{customerOptions.isLoading ? "กำลังโหลดลูกค้า…" : "เลือกลูกค้าที่มีอย่างน้อย 2 รายการ"}</option>
                {orderedCustomers.map((customer) => <option key={customer.id} value={customer.id}>{customer.mainName}</option>)}
              </select>
            </label>
            <label className="block"><span className="mb-1 block text-sm font-semibold text-ink">บัญชีรับเงิน</span>
              <select value={destinationAccount?.accountNumber ?? ""} onChange={(event) => setAccountNumber(event.target.value)} disabled={!customerId || !accounts.length}
                className="focus-ring h-10 w-full rounded-md border border-black/15 bg-white px-3 text-sm disabled:bg-field">
                {!accounts.length && <option value="">— ไม่ระบุบัญชี —</option>}
                {accounts.map((account) => <option key={account.id} value={account.accountNumber}>{account.isPrimary ? "[หลัก] " : ""}{account.bankName} · {account.accountNumber} · {account.accountName}</option>)}
              </select>
            </label>
          </div>}
          {bundleType === "customer" && !customerOptions.isLoading && !customerOptions.error && !orderedCustomers.length &&
            <p role="status" className="text-pretty text-sm text-ink/60">ยังไม่มีลูกค้าที่มีรายการรอโอนหรือค้างจ่ายที่รวมได้อย่างน้อย 2 รายการ</p>}
          {candidates.isLoading ? <p className="text-sm text-ink/60">กำลังตรวจรายการที่รวมได้…</p> : candidates.data && <div className="rounded-lg border border-river/20 bg-mint/25 p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><p className="font-semibold text-ink">รายการที่จะรวม <span className="tabular-nums">{candidates.data.eligibleCount}</span> รายการ</p>
                <p className="text-sm text-ink/60">อยู่ในชุดอื่น {candidates.data.alreadyBundledCount} · Report Lock {candidates.data.reportLockedCount}</p></div>
              <strong className="text-xl tabular-nums text-river">{formatCurrency(candidates.data.eligibleAmount)}</strong>
            </div>
            <div className="mt-3 max-h-52 overflow-auto rounded border border-black/10 bg-white">
              {candidates.data.rows.map((row) => <div key={row.id} className="flex justify-between gap-3 border-b border-black/5 px-3 py-2 text-sm last:border-0">
                <span className="text-pretty">{row.rubberExportNo ?? row.customerName ?? row.id}
                  <span className="block text-xs text-ink/60">{row.id.slice(0, 8)} · {row.transferStatus === "partial" ? "ค้างจ่าย" : "รอโอน"} · บัญชีเดิม {row.accountNumber ?? "ไม่ระบุ"}</span>
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{formatCurrency(row.outstandingAmount ?? row.netAmountToPay)}</span>
              </div>)}
            </div>
          </div>}
          <div className="modal-actions flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="focus-ring h-10 rounded-md bg-field px-4 text-sm font-semibold text-ink">ยกเลิก</button>
            <button type="button" onClick={() => void createBundle()} disabled={!canCreate}
              className="focus-ring inline-flex h-10 items-center gap-2 rounded-md bg-leaf px-4 text-sm font-semibold text-white disabled:opacity-40">
              {mutations.createPaymentBundle.isPending ? <Loader2 size={16} className="animate-spin" /> : <Layers3 size={16} />} สร้างชุดรวม
            </button>
          </div>
        </> : detail.isLoading && !bundle?.bundleSummary ? <p className="text-sm text-ink/60">กำลังโหลดชุดรวม…</p> : bundle && <>
          <div className="grid gap-3 rounded-lg border border-river/20 bg-mint/25 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div><span className="text-xs text-ink/55">รายการลูก</span><strong className="block tabular-nums">{summary?.childCount ?? 0} รายการ</strong></div>
            <div><span className="text-xs text-ink/55">ยอดคงเหลือลูก</span><strong className="block tabular-nums text-river">{formatCurrency(summary?.amountDue ?? bundle.netAmountToPay)}</strong></div>
            <div><span className="text-xs text-ink/55">ยอดสลิปชุด</span><strong className="block tabular-nums text-leaf">{formatCurrency(paid)}</strong></div>
            <div><span className="text-xs text-ink/55">คงเหลือหลังสลิป</span><div className="flex items-center gap-2">
              <strong className="block tabular-nums text-amber">{formatCurrency(remaining)}</strong>
              <button type="button" onClick={() => void copy(remaining.toFixed(2), "คัดลอกยอดคงเหลือแล้ว")}
                disabled={remaining <= 0 || branchPaysRemaining} aria-label="คัดลอกยอดคงเหลือ" title="คัดลอกยอดคงเหลือ"
                className="focus-ring inline-flex size-10 shrink-0 items-center justify-center rounded-md text-actionSecondary hover:bg-actionSecondary/10 disabled:cursor-not-allowed disabled:opacity-50"><Copy size={16} aria-hidden="true" /></button>
            </div></div>
            {bundle.accountNumber && <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center gap-2 border-t border-river/15 pt-3 text-sm">
              <span>{bundle.bankName} · <span className="font-mono tabular-nums">{bundle.accountNumber}</span> · {bundle.accountName}</span>
              <button type="button" onClick={() => void copy(bundle.accountNumber!, "คัดลอกเลขบัญชีแล้ว")} className="focus-ring inline-flex h-10 items-center gap-1 rounded bg-actionSecondary px-3 text-xs font-semibold text-white"><Copy size={13} /> คัดลอกบัญชี</button>
            </div>}
          </div>
          <div><h3 className="mb-2 font-semibold text-ink">รายการลูกในชุด</h3>
            <div className="max-h-72 overflow-auto rounded-lg border border-black/10">
              {(bundle.bundleChildren ?? []).map((child, index) => <div id={`bundle-child-${child.id}`} key={child.id} className={`grid grid-cols-[auto_1fr] items-center gap-3 border-b border-black/5 p-3 last:border-0 sm:grid-cols-[auto_1fr_auto] ${initialBundle?.matchedChildId === child.id ? "bg-amber/10" : ""}`}>
                <button type="button" onClick={() => setSourceTransfer(child)} aria-label={`ดูบิลรายการลูก ${index + 1}`}
                  autoFocus={initialBundle?.matchedChildId === child.id}
                  className="focus-ring inline-flex h-10 items-center gap-1 rounded-md bg-actionSecondary px-3 text-xs font-semibold text-white"><Eye size={14} /> ดูบิล</button>
                <div className="min-w-0 text-sm"><p className="truncate font-semibold">{child.rubberExportNo ?? child.customerName ?? child.id}</p>
                  <p className="text-xs text-ink/55">สลิปเดิม {child.slips?.length ?? 0} · จัดสรรจากชุด {formatCurrency(child.bundleAllocatedAmount ?? 0)}</p>
                  {Boolean(child.slips?.length) && <p className="mt-1 text-xs tabular-nums text-ink/60">{child.slips!.map((slip, slipIndex) => `สลิป ${slipIndex + 1}: ${formatCurrency(slip.amount)}`).join(" · ")}</p>}
                </div>
                <strong className="col-span-2 text-right text-sm tabular-nums text-river sm:col-span-1">คงเหลือ {formatCurrency(child.bundleRemainingAmount ?? child.outstandingAmount ?? 0)}</strong>
              </div>)}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-ink">สลิปของชุดรวม</h3><div className="flex gap-2">
            <button type="button" onClick={addSlip} disabled={!online || busy || Boolean(bundle.reportLockNo)} className="focus-ring flex items-center gap-1.5 rounded-md bg-leaf px-3 py-2 text-sm font-semibold text-white hover:bg-leaf/90 disabled:cursor-not-allowed disabled:opacity-50"><Plus size={14} /> เพิ่มเอง</button>
            <button type="button" onClick={() => fileInput.current?.click()} disabled={!online || busy || Boolean(bundle.reportLockNo)} className="focus-ring flex items-center gap-1.5 rounded-md bg-river px-3 py-2 text-sm font-semibold text-white hover:bg-river/90 disabled:cursor-not-allowed disabled:opacity-50">{uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} อ่านสลิป</button>
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" aria-label="เลือกรูปสลิปชุดรวม" onChange={(event) => void readSlip(event.target.files)} />
          </div></div>
          {slips.map((slip, index) => <SlipRow key={slip.id} slip={slip} index={index} hidePartyFields
            readOnly={Boolean(bundle.reportLockNo)}
            errors={Object.fromEntries(issues.filter((issue) => issue.slipId === slip.id).map((issue) => [issue.field, issue.message]))}
            onUpdate={(id, field, value) => { setSlips((current) => current.map((item) => item.id === id ? { ...item, [field]: value } : item)); setIssues((current) => current.filter((issue) => issue.slipId !== id || issue.field !== field)); }}
            onRemove={(id) => { setSlips((current) => current.filter((item) => item.id !== id)); setIssues((current) => current.filter((issue) => issue.slipId !== id)); }} />)}
          {!slips.length && <p className="rounded-lg border border-dashed border-black/10 p-4 text-sm text-ink/55">ยังไม่มีสลิปในชุด รายการลูกยังเก็บสลิปเดิมของตนไว้แบบอ่านอย่างเดียว</p>}
          <SlipValidationSummary issues={issues} />
          {bundleType === "customer" && paid > 0 && paid < (summary?.amountDue ?? bundle.netAmountToPay) && <label className="flex items-center gap-2 rounded-md bg-field p-3 text-sm font-semibold text-ink"><input type="checkbox" checked={branchPaysRemaining} disabled={Boolean(bundle.reportLockNo)} onChange={(event) => setBranchPaysRemaining(event.target.checked)} /> สาขาจ่ายส่วนที่เหลือ {formatCurrency(remaining)}</label>}
          <div className="modal-actions flex flex-wrap justify-between gap-2"><button type="button" onClick={() => setConfirmDissolve(true)} disabled={!canDissolve || busy} title={bundle.reportLockNo ? `ล็อกโดยรายงาน ${bundle.reportLockNo}` : bundle.bundleFrozenAt ? "ชุดนี้เคยเริ่มจ่ายแล้ว จึงยุบไม่ได้" : slips.length ? "ลบสลิปของชุดก่อนยุบ" : "ยุบชุดและแสดงรายการลูกอีกครั้ง"} className="focus-ring h-10 rounded-md bg-clay px-4 text-sm font-semibold text-white disabled:opacity-40">ยุบชุดรวม</button>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={onClose} disabled={busy} className="focus-ring h-10 rounded-md bg-field px-4 text-sm font-semibold text-ink">ปิด</button>
              <button type="button" onClick={() => void saveBundle()} disabled={!online || busy || Boolean(bundle.reportLockNo)} className="focus-ring flex items-center gap-1.5 rounded-md bg-commit px-5 py-2 text-sm font-semibold text-white hover:bg-commit/90 disabled:cursor-not-allowed disabled:opacity-50">{mutations.savePaymentBundle.isPending && <Loader2 size={15} className="animate-spin" />} บันทึก</button></div>
          </div>
        </>}
        {(visibleError || notice) && <p role={visibleError ? "alert" : "status"} className={`text-pretty text-sm font-semibold ${visibleError ? "text-clay" : "text-leaf"}`}>{visibleError ?? notice}</p>}
      </div>
    </ModalShell>
    <AlertDialog open={confirmDissolve} title="ยุบชุดจ่ายรวม" description="รายการลูกทั้งหมดจะกลับมาแสดงในรายการหลัก ข้อมูลต้นทางและสลิปเดิมจะไม่ถูกลบ" confirmLabel="ยุบชุด" busy={mutations.dissolvePaymentBundle.isPending} onCancel={() => setConfirmDissolve(false)} onConfirm={() => void dissolve()} />
    {sourceTransfer && <MoneyTransferSourceDetailsModal transfer={sourceTransfer} nativeModal onClose={() => setSourceTransfer(null)} />}
  </>;
}
