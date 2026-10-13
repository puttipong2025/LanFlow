"use client";

import { FormEvent, useRef, useState } from "react";
import { toast } from "sonner";

import { Field } from "@/components/shared/Field";
import { ModalShell } from "@/components/shared/ModalShell";
import { NumberField } from "@/components/shared/NumberField";
import { usePersistentFormDraft } from "@/hooks/usePersistentFormDraft";
import { ApiResponseError } from "@/lib/auth-fetch";
import { todayInputValue } from "@/lib/format";
import type { AcidProduct, Location } from "@/types";

function newCommandId() {
  return crypto.randomUUID();
}

function isAmbiguousFailure(error: unknown) {
  return !(error instanceof ApiResponseError) || error.status >= 500;
}

function failureMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

type ReceiveDraft = {
  entryId: string;
  productId: string;
  txDate: string;
  quantity: number;
  amount: number;
  ambiguous: boolean;
};

export function ReceiveModal({
  ownerUserId,
  location,
  products,
  online,
  onClose,
  onSave,
}: {
  ownerUserId: string;
  location: Location;
  products: AcidProduct[];
  online: boolean;
  onClose: () => void;
  onSave: (input: Omit<ReceiveDraft, "ambiguous">) => Promise<unknown>;
}) {
  const [entryId, setEntryId] = useState(newCommandId);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [txDate, setTxDate] = useState(todayInputValue);
  const [quantity, setQuantity] = useState(1);
  const [amount, setAmount] = useState(0);
  const [ambiguous, setAmbiguous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busyRef = useRef(false);
  const draft: ReceiveDraft = { entryId, productId, txDate, quantity, amount, ambiguous };
  const { clearDraft, flushDraft, hydrated } = usePersistentFormDraft({
    partition: { ownerUserId, locationId: location.id, formType: "stock-receive" },
    enabled: true,
    value: draft,
    onRestore: (saved: ReceiveDraft) => {
      setEntryId(saved.entryId);
      setProductId(saved.productId);
      setTxDate(saved.txDate);
      setQuantity(saved.quantity);
      setAmount(saved.amount);
      setAmbiguous(Boolean(saved.ambiguous));
      if (saved.ambiguous) {
        setMessage("ยังยืนยันผลไม่ได้ ข้อมูลเดิมถูกเก็บไว้ กดลองส่งข้อมูลเดิมอีกครั้ง หรือตรวจรายการก่อน");
      }
    },
  });

  async function handleClose() {
    if (busyRef.current) return;
    if (!ambiguous) await clearDraft().catch(() => {});
    onClose();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || !hydrated) return;
    if (!online) {
      setMessage("รับเข้าสต็อกใช้ได้เมื่อออนไลน์ เพราะต้องตรวจยอดสินค้า");
      return;
    }
    if (!productId || quantity <= 0) {
      setMessage("กรุณาเลือกสินค้าและระบุจำนวนให้ถูกต้อง");
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await flushDraft();
      await onSave({ entryId, productId, txDate, quantity, amount });
      await clearDraft();
      toast.success("รับเข้าสต็อกแล้ว");
      onClose();
    } catch (error) {
      const uncertain = isAmbiguousFailure(error);
      setAmbiguous(uncertain);
      if (uncertain) await flushDraft({ ...draft, ambiguous: true }).catch(() => {});
      setMessage(uncertain
        ? "ยังยืนยันผลไม่ได้ ข้อมูลเดิมถูกเก็บไว้ กดลองส่งข้อมูลเดิมอีกครั้ง หรือตรวจรายการก่อน"
        : failureMessage(error, "รับเข้าสต็อกไม่สำเร็จ"));
      if (!uncertain) setEntryId(newCommandId());
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <ModalShell title="รับเข้าสต็อก" subtitle={location.name} onClose={() => void handleClose()} closeDisabled={busy} size="normal">
      <form onSubmit={handleSubmit} aria-busy={busy} className="space-y-4 p-4">
        <fieldset disabled={busy || ambiguous} className="space-y-4 disabled:opacity-70">
          <Field label="วันที่" name="txDate" type="date" value={txDate} onChange={(event) => setTxDate(event.target.value)} required />
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink/70">สินค้า</span>
            <select value={productId} onChange={(event) => setProductId(event.target.value)} className="focus-ring h-11 w-full rounded-md border border-black/10 bg-white px-3" required>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </label>
          <NumberField label="จำนวน" value={quantity} onChange={setQuantity} />
          <NumberField label="ยอดเงิน" value={amount} onChange={setAmount} />
        </fieldset>
        {message && (
          <p role={ambiguous ? "status" : "alert"} className={`rounded-md px-3 py-2 text-sm font-semibold ${ambiguous ? "bg-amber/20 text-amber-900" : "bg-red-50 text-red-700"}`}>
            {message}
          </p>
        )}
        <div className="modal-actions flex justify-end gap-2 border-t border-black/10 pt-4">
          <button type="button" onClick={() => void handleClose()} disabled={busy} className="focus-ring h-11 rounded-md bg-actionSecondary px-4 font-semibold text-white hover:bg-actionSecondary/90 disabled:cursor-not-allowed disabled:opacity-45">
            {ambiguous ? "ปิดไปตรวจรายการ" : "ยกเลิก"}
          </button>
          <button disabled={!online || !hydrated || busy} className="focus-ring h-11 rounded-md bg-commit px-4 font-semibold text-white hover:bg-commit/90 disabled:cursor-not-allowed disabled:bg-slate-300">
            {busy ? "กำลังบันทึก..." : ambiguous ? "ลองส่งข้อมูลเดิมอีกครั้ง" : "บันทึก"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

type TransferDraft = {
  outId: string;
  inId: string;
  productId: string;
  toLocationId: string;
  txDate: string;
  quantity: number;
  ambiguous: boolean;
};

export function TransferModal({
  ownerUserId,
  location,
  locations,
  products,
  balances,
  online,
  onClose,
  onSave,
}: {
  ownerUserId: string;
  location: Location;
  locations: Location[];
  products: AcidProduct[];
  balances: Map<string, number>;
  online: boolean;
  onClose: () => void;
  onSave: (input: Omit<TransferDraft, "ambiguous">) => Promise<unknown>;
}) {
  const [outId, setOutId] = useState(newCommandId);
  const [inId, setInId] = useState(newCommandId);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [toLocationId, setToLocationId] = useState(locations.find((item) => item.id !== location.id)?.id ?? "");
  const [txDate, setTxDate] = useState(todayInputValue);
  const [quantity, setQuantity] = useState(1);
  const [ambiguous, setAmbiguous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busyRef = useRef(false);
  const balance = balances.get(productId) ?? 0;
  const draft: TransferDraft = { outId, inId, productId, toLocationId, txDate, quantity, ambiguous };
  const { clearDraft, flushDraft, hydrated } = usePersistentFormDraft({
    partition: { ownerUserId, locationId: location.id, formType: "stock-transfer" },
    enabled: true,
    value: draft,
    onRestore: (saved: TransferDraft) => {
      setOutId(saved.outId);
      setInId(saved.inId);
      setProductId(saved.productId);
      setToLocationId(saved.toLocationId);
      setTxDate(saved.txDate);
      setQuantity(saved.quantity);
      setAmbiguous(Boolean(saved.ambiguous));
      if (saved.ambiguous) {
        setMessage("ยังยืนยันผลไม่ได้ ข้อมูลเดิมถูกเก็บไว้ กดลองส่งข้อมูลเดิมอีกครั้ง หรือตรวจรายการก่อน");
      }
    },
  });

  async function handleClose() {
    if (busyRef.current) return;
    if (!ambiguous) await clearDraft().catch(() => {});
    onClose();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || !hydrated) return;
    if (!online) {
      setMessage("ย้ายสต็อกใช้ได้เมื่อออนไลน์ เพราะต้องตรวจยอดสินค้า");
      return;
    }
    if (!productId || !toLocationId || quantity <= 0) {
      setMessage("กรุณาเลือกสินค้า สาขาปลายทาง และจำนวนให้ถูกต้อง");
      return;
    }
    if (quantity > balance) {
      setMessage("จำนวนย้ายมากกว่ายอดคงเหลือ");
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await flushDraft();
      await onSave({ outId, inId, productId, toLocationId, txDate, quantity });
      await clearDraft();
      toast.success("ย้ายสต็อกแล้ว");
      onClose();
    } catch (error) {
      const uncertain = isAmbiguousFailure(error);
      setAmbiguous(uncertain);
      if (uncertain) await flushDraft({ ...draft, ambiguous: true }).catch(() => {});
      setMessage(uncertain
        ? "ยังยืนยันผลไม่ได้ ข้อมูลเดิมถูกเก็บไว้ กดลองส่งข้อมูลเดิมอีกครั้ง หรือตรวจรายการก่อน"
        : failureMessage(error, "ย้ายสต็อกไม่สำเร็จ"));
      if (!uncertain) {
        setOutId(newCommandId());
        setInId(newCommandId());
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <ModalShell title="ย้ายสต็อก" subtitle={location.name} onClose={() => void handleClose()} closeDisabled={busy} size="normal">
      <form onSubmit={handleSubmit} aria-busy={busy} className="space-y-4 p-4">
        <fieldset disabled={busy || ambiguous} className="space-y-4 disabled:opacity-70">
          <Field label="วันที่" name="txDate" type="date" value={txDate} onChange={(event) => setTxDate(event.target.value)} required />
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink/70">สินค้า</span>
            <select value={productId} onChange={(event) => setProductId(event.target.value)} className="focus-ring h-11 w-full rounded-md border border-black/10 bg-white px-3" required>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-semibold text-ink/70">ไปสาขา</span>
            <select value={toLocationId} onChange={(event) => setToLocationId(event.target.value)} className="focus-ring h-11 w-full rounded-md border border-black/10 bg-white px-3" required>
              {locations.filter((item) => item.id !== location.id).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <div className="rounded-md bg-field p-3 text-sm font-semibold text-ink">
            คงเหลือปัจจุบัน: <span className="text-leaf">{balance.toLocaleString("th-TH")}</span>
          </div>
          <NumberField label="จำนวนย้าย" value={quantity} onChange={setQuantity} />
        </fieldset>
        {message && (
          <p role={ambiguous ? "status" : "alert"} className={`rounded-md px-3 py-2 text-sm font-semibold ${ambiguous ? "bg-amber/20 text-amber-900" : "bg-red-50 text-red-700"}`}>
            {message}
          </p>
        )}
        <div className="modal-actions flex justify-end gap-2 border-t border-black/10 pt-4">
          <button type="button" onClick={() => void handleClose()} disabled={busy} className="focus-ring h-11 rounded-md bg-actionSecondary px-4 font-semibold text-white hover:bg-actionSecondary/90 disabled:cursor-not-allowed disabled:opacity-45">
            {ambiguous ? "ปิดไปตรวจรายการ" : "ยกเลิก"}
          </button>
          <button disabled={!online || !hydrated || busy} className="focus-ring h-11 rounded-md bg-commit px-4 font-semibold text-white hover:bg-commit/90 disabled:cursor-not-allowed disabled:bg-slate-300">
            {busy ? "กำลังย้าย..." : ambiguous ? "ลองส่งข้อมูลเดิมอีกครั้ง" : "บันทึก"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
