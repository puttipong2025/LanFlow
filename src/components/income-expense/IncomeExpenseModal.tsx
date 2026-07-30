import { toast } from "sonner";
import { ArrowDown, ArrowUp, ReceiptText, WalletCards, WifiOff } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

import {
  makeClientRecordedAt,
  makeClientTempId,
  makeIdempotencyKey,
  makeLocalBillNo,
  todayInputValue
} from "@/lib/format";

import type { IncomeExpense, IncomeExpenseSaleLine, Location, Profile } from "@/types";
import { useIncomeSaleItems } from "@/hooks/useIncomeSaleItems";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { usePersistentFormDraft } from "@/hooks/usePersistentFormDraft";
import { ModalShell } from "@/components/shared/ModalShell";
import { Field } from "@/components/shared/Field";
import { InlineNumber } from "@/components/shared/InlineNumber";
import { SyncStatusBadge } from "@/components/shared/SyncStatusBadge";

export function IncomeExpenseModal({
  selectedLocation,
  profile,
  type,
  transaction,
  nextNumber,
  nextLocalSequence,
  onClose,
  onSave
}: {
  selectedLocation: Location;
  profile: Profile;
  type: "income" | "expense";
  transaction: IncomeExpense | null;
  nextNumber: string;
  nextLocalSequence: number;
  onClose: () => void;
  onSave: (
    transactions: IncomeExpense[]
  ) => boolean | void | Promise<boolean | void>;
}) {
  type CashLine = {
    id: string;
    title: string;
    incomeSaleItemId?: string | null;
    stockProductId?: string | null;
    unit: number;
    price: number;
    cost: number;
  };
  const initialSaleLines = transaction?.billOption === "บิลขาย"
    ? transaction.saleLines ?? []
    : [];
  const initialLocalBillNo = transaction?.localBillNo ?? makeLocalBillNo(selectedLocation.code, type === "income" ? "I" : "E", nextLocalSequence);

  const [lines, setLines] = useState<CashLine[]>(
    initialSaleLines.length > 0
      ? initialSaleLines.map((line) => ({
          id: line.id ?? makeClientTempId("cash_line"),
          title: line.title,
          incomeSaleItemId: line.incomeSaleItemId,
          stockProductId: line.stockProductId,
          unit: line.quantity,
          price: line.unitPrice,
          cost: line.lineTotal,
        }))
      : [{
          id: transaction?.clientTempId ?? makeClientTempId("cash_line"),
          title: transaction?.title ?? "",
          incomeSaleItemId: null,
          stockProductId: null,
          unit: Number(transaction?.unit || 0),
          price: transaction?.price ?? 0,
          cost: transaction?.cost ?? 0
        }]
  );
  const [txDate, setTxDate] = useState(transaction?.txDate ?? todayInputValue());
  const label = type === "income" ? "รายรับ" : "ค่าใช้จ่าย";
  const [billOption, setBillOption] = useState<string>(transaction?.billOption ?? (type === "income" ? "รายรับ" : "ค่าใช้จ่าย"));
  const { items: saleItems } = useIncomeSaleItems({ stockOnly: true });
  const isOnline = useOnlineStatus();
  const billOptions = type === "income"
    ? [
        {
          value: "รายรับ",
          title: "รายรับทั่วไป",
          description: "บันทึกรายรับที่ไม่ตัดสต็อก",
          icon: WalletCards
        },
        {
          value: "บิลขาย",
          title: "บิลขาย",
          description: "เลือกสินค้าจากสต็อกและตัดยอดสินค้า",
          icon: ReceiptText,
          onlineOnly: true
        }
      ]
    : [
        {
          value: "ค่าใช้จ่าย",
          title: "ค่าใช้จ่าย",
          description: "บันทึกรายจ่ายทั่วไป",
          icon: WalletCards
        }
      ];
  const draftValue = useMemo(() => ({
    txDate,
    billOption,
    lines,
  }), [billOption, lines, txDate]);
  const { clearDraft } = usePersistentFormDraft({
    partition: {
      ownerUserId: profile.id,
      locationId: selectedLocation.id,
      formType: type,
    },
    enabled: !transaction,
    value: draftValue,
    onRestore: (draft) => {
      setTxDate(draft.txDate || todayInputValue());
      setBillOption(draft.billOption || (type === "income" ? "รายรับ" : "ค่าใช้จ่าย"));
      if (Array.isArray(draft.lines) && draft.lines.length > 0) {
        setLines(draft.lines);
      }
    },
  });

  function updateLine(id: string, patch: Partial<Omit<CashLine, "id">>) {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function addLine() {
    if (billOption === "บิลขาย" && lines.length >= 50) {
      toast.error("บิลขายเพิ่มได้สูงสุด 50 รายการ");
      return;
    }
    setLines((current) => [
      ...current,
      { id: makeClientTempId("cash_line"), title: "", incomeSaleItemId: null, stockProductId: null, unit: 0, price: 0, cost: 0 }
    ]);
  }

  function removeLine(id: string) {
    setLines((current) => (current.length === 1 ? current : current.filter((line) => line.id !== id)));
  }

  function moveLine(id: string, offset: -1 | 1) {
    setLines((current) => {
      const from = current.findIndex((line) => line.id === id);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const reordered = [...current];
      [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
      return reordered;
    });
  }

  function getLineCost(line: CashLine) {
    if (billOption === "บิลขาย") return Math.round((line.unit * line.price + Number.EPSILON) * 100) / 100;
    return line.cost;
  }

  function selectBillOption(option: string) {
    if (transaction && option !== transaction.billOption) {
      toast.error("ไม่สามารถเปลี่ยนรูปแบบของรายการที่บันทึกแล้ว");
      return;
    }
    if (option === "บิลขาย" && !isOnline) {
      toast.error("บิลขายใช้ได้เมื่อออนไลน์ เพราะต้องตรวจยอดสต็อกก่อน");
      return;
    }

    setBillOption(option);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (billOption === "บิลขาย" && !isOnline) {
      toast.error("บิลขายใช้ได้เมื่อออนไลน์ เพราะต้องตรวจยอดสต็อกก่อนบันทึก");
      return;
    }

    const invalidSaleLine = billOption === "บิลขาย" && lines.some((line) => {
      const touched = Boolean(
        line.title.trim()
        || line.incomeSaleItemId
        || line.stockProductId
        || line.unit
        || line.price
      );
      return touched && !(
        line.title.trim()
        && line.incomeSaleItemId
        && line.stockProductId
        && line.unit > 0
        && line.price > 0
      );
    });
    if (invalidSaleLine) {
      toast.error("กรุณากรอกสินค้า จำนวน และราคาให้ครบทุกแถวที่ใช้งาน");
      return;
    }

    const filledLines = lines.filter((line) => {
      if (billOption === "บิลขาย") {
        return line.title.trim() && line.incomeSaleItemId && line.stockProductId && line.unit > 0 && line.price > 0;
      }
      return line.title.trim() && line.cost > 0;
    });

    if (filledLines.length === 0) {
      toast.error("กรุณาเพิ่มรายการและจำนวนเงิน/ราคาให้ถูกต้องอย่างน้อย 1 รายการ");
      return;
    }

    if (
      billOption === "บิลขาย"
      && filledLines.some((line) =>
        !Number.isInteger(line.unit)
        || line.unit <= 0
        || line.price <= 0
        || Math.abs(line.price * 100 - Math.round(line.price * 100)) > 1e-7
      )
    ) {
      toast.error("จำนวนสินค้าต้องเป็นจำนวนเต็มมากกว่า 0 และราคามีทศนิยมได้ไม่เกิน 2 ตำแหน่ง");
      return;
    }

    if (billOption === "บิลขาย") {
      const clientTempId = transaction?.clientTempId ?? makeClientTempId("cash");
      const clientRecordedAt = transaction?.clientRecordedAt ?? makeClientRecordedAt();
      const saleLines: IncomeExpenseSaleLine[] = filledLines.map((line, index) => ({
        incomeSaleItemId: line.incomeSaleItemId!,
        stockProductId: line.stockProductId!,
        title: line.title.trim(),
        quantity: line.unit,
        unitPrice: line.price,
        lineTotal: getLineCost(line),
        sequenceNo: index + 1,
      }));
      const saved = await onSave([{
        id: transaction?.id ?? clientTempId,
        clientTempId,
        localBillNo: transaction?.localBillNo ?? initialLocalBillNo,
        serverBillNo: transaction?.serverBillNo,
        syncStatus: transaction?.syncStatus ?? "pending",
        idempotencyKey: transaction?.idempotencyKey ?? makeIdempotencyKey("create", clientTempId),
        locationId: selectedLocation.id,
        type,
        number: String(form.get("number") || nextNumber),
        txDate,
        title: `บิลขาย — ${saleLines.length} รายการ`,
        cost: saleLines.reduce((sum, line) => sum + line.lineTotal, 0),
        billOption: "บิลขาย",
        saleLineCount: saleLines.length,
        saleLines,
        createdByUserId: transaction?.createdByUserId ?? profile.id,
        createdByName: transaction?.createdByName ?? profile.name,
        createdByPhone: transaction?.createdByPhone ?? profile.phone,
        clientCreatedAt: transaction?.clientCreatedAt ?? clientRecordedAt,
        serverCreatedAt: transaction?.serverCreatedAt,
        clientRecordedAt,
        serverReceivedAt: transaction?.serverReceivedAt,
        revisionNo: transaction?.revisionNo ?? 0,
        recordStatus: transaction?.recordStatus ?? "active",
      }]);
      if (saved !== false && !transaction) await clearDraft();
      return;
    }

    const saved = await onSave(
      filledLines.map((line, index) => {
        const clientTempId = index === 0 && transaction ? transaction.clientTempId : makeClientTempId("cash");
        const clientRecordedAt = index === 0 && transaction ? transaction.clientRecordedAt : makeClientRecordedAt();
        const localBillNo = index === 0 && transaction
          ? transaction.localBillNo
          : makeLocalBillNo(selectedLocation.code, type === "income" ? "I" : "E", Number(nextNumber) + index);
        return {
          id: index === 0 && transaction ? transaction.id : clientTempId,
          clientTempId,
          localBillNo,
          serverBillNo: index === 0 && transaction ? transaction.serverBillNo : undefined,
          syncStatus: index === 0 && transaction ? transaction.syncStatus : "pending",
          idempotencyKey: index === 0 && transaction ? transaction.idempotencyKey : makeIdempotencyKey("create", clientTempId),
          locationId: selectedLocation.id,
          type,
          number: String(form.get("number") || nextNumber),
          txDate,
          title: line.title.trim() || `${label} ${index + 1}`,
          cost: getLineCost(line),
          billOption: billOption as any,
          unit: line.unit ? String(line.unit) : undefined,
          price: line.price || undefined,
          createdByUserId: index === 0 && transaction ? transaction.createdByUserId : profile.id,
          createdByName: index === 0 && transaction ? transaction.createdByName : profile.name,
          createdByPhone: index === 0 && transaction ? transaction.createdByPhone : profile.phone,
          clientCreatedAt: index === 0 && transaction ? transaction.clientCreatedAt : clientRecordedAt,
          serverCreatedAt: index === 0 && transaction ? transaction.serverCreatedAt : undefined,
          clientRecordedAt,
          serverReceivedAt: index === 0 && transaction ? transaction.serverReceivedAt : undefined,
          revisionNo: index === 0 && transaction ? transaction.revisionNo : 0,
          recordStatus: index === 0 && transaction ? transaction.recordStatus : "active"
        };
      })
    );
    if (saved !== false && !transaction) await clearDraft();
  }

  async function handleClose() {
    if (transaction) {
      onClose();
      return;
    }
    const defaultOption = type === "income" ? "รายรับ" : "ค่าใช้จ่าย";
    const hasDraftContent = Boolean(
      txDate !== todayInputValue()
      || billOption !== defaultOption
      || lines.some((line) =>
        line.title.trim()
        || line.incomeSaleItemId
        || line.stockProductId
        || line.unit
        || line.price
        || line.cost
      )
    );
    if (
      hasDraftContent
      && !confirm(`ยกเลิกและลบแบบร่าง${type === "income" ? "รายรับ" : "รายจ่าย"}นี้ใช่หรือไม่?`)
    ) return;
    await clearDraft();
    onClose();
  }

  return (
    <ModalShell
      title="เพิ่ม/แก้ไข บิลเงินสด"
      subtitle={selectedLocation.name}
      onClose={() => void handleClose()}
      size="wide"
    >
      <form onSubmit={handleSubmit} className="space-y-0">
        {/* Section: Bill information */}
        <section className="bg-slate-50 p-3 sm:p-4">
          <h3 className="mb-4 font-bold text-ink">ข้อมูลบิล</h3>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="เลขบิลชั่วคราว" name="localBillNo" defaultValue={transaction?.localBillNo ?? initialLocalBillNo} required readOnly />
            <Field label="เลขที่" name="number" defaultValue={transaction?.number ?? nextNumber} required readOnly />
            <Field
              label="วันที่"
              name="txDate"
              type="date"
              value={txDate}
              onChange={(event) => setTxDate(event.target.value)}
              required
            />
          </div>
        </section>

        <section className="p-3 sm:p-4">
          <p className="mb-3 font-bold text-ink">รูปแบบ</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {billOptions.map((option) => {
              const Icon = option.icon;
              const active = billOption === option.value;
              const blocked = Boolean(option.onlineOnly && !isOnline);

              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  aria-disabled={blocked}
                  onClick={() => selectBillOption(option.value)}
                  className={`focus-ring flex min-h-[76px] items-center gap-3 rounded-md border px-3 py-3 text-left transition-colors ${
                    blocked
                      ? "cursor-not-allowed border-amber bg-amber text-white opacity-50"
                      : active
                      ? "border-leaf bg-leaf text-white shadow-sm"
                      : "border-actionSecondary bg-actionSecondary text-white hover:bg-actionSecondary/90"
                  }`}
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-white/15 text-white">
                    <Icon size={19} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-bold">
                      {option.title}
                      {option.onlineOnly && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-bold text-white">
                          <WifiOff size={12} />
                          {blocked ? "กดได้เมื่อออนไลน์" : "ตรวจสต็อก"}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs font-semibold text-white/80">
                      {option.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="bg-mint/45 p-3 sm:p-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/80 text-left text-base font-bold text-ink">
                  <th className="px-2 py-2">รายการ</th>
                  {billOption === "บิลขาย" && <th className="px-2 py-2">จำนวน</th>}
                  {billOption === "บิลขาย" && <th className="px-2 py-2">ราคา</th>}
                  <th className="px-2 py-2">{label}</th>
                  <th className="px-2 py-2 text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={line.id} className="border-b border-black/10">
                    <td className="px-2 py-2">
                      {billOption === "บิลขาย" ? (
                        <select
                          value={line.incomeSaleItemId ?? ""}
                          onChange={(event) => {
                            const saleItem = saleItems.find((item) => item.id === event.target.value);
                            updateLine(line.id, {
                              incomeSaleItemId: saleItem?.id ?? null,
                              stockProductId: saleItem?.stockProductId ?? null,
                              title: saleItem?.name ?? "",
                            });
                          }}
                          className="focus-ring h-10 w-full rounded-md border border-black/10 bg-white px-3"
                          required
                        >
                          <option value="" disabled>เลือกรหัสสินค้า</option>
                          {saleItems.map(item => (
                            <option key={item.id} value={item.id}>{item.name}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={line.title}
                          onChange={(event) => updateLine(line.id, { title: event.target.value })}
                          className="focus-ring h-10 w-full rounded-md border border-black/10 bg-white px-3"
                          required
                        />
                      )}
                    </td>
                    {billOption === "บิลขาย" && (
                      <td className="px-2 py-2">
                        <InlineNumber value={line.unit} integerOnly onChange={(value) => updateLine(line.id, { unit: value })} />
                      </td>
                    )}
                    {billOption === "บิลขาย" && (
                      <td className="px-2 py-2">
                        <InlineNumber value={line.price} onChange={(value) => updateLine(line.id, { price: value })} />
                      </td>
                    )}
                    <td className="px-2 py-2">
                      {billOption === "บิลขาย" ? (
                        <div className="flex h-10 items-center justify-end rounded-md border border-black/5 bg-slate-50 px-3 text-right text-sm font-semibold text-ink/70">
                          {(line.unit * line.price).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                      ) : (
                        <InlineNumber value={line.cost} onChange={(value) => updateLine(line.id, { cost: value })} />
                      )}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <div className="flex justify-center gap-1">
                        {billOption === "บิลขาย" && (
                          <>
                            <button
                              type="button"
                              aria-label={`เลื่อนรายการ ${index + 1} ขึ้น`}
                              title="เลื่อนขึ้น"
                              onClick={() => moveLine(line.id, -1)}
                              disabled={index === 0}
                              className="grid h-9 w-9 place-items-center rounded-md bg-actionSecondary text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                            >
                              <ArrowUp size={15} />
                            </button>
                            <button
                              type="button"
                              aria-label={`เลื่อนรายการ ${index + 1} ลง`}
                              title="เลื่อนลง"
                              onClick={() => moveLine(line.id, 1)}
                              disabled={index === lines.length - 1}
                              className="grid h-9 w-9 place-items-center rounded-md bg-actionSecondary text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                            >
                              <ArrowDown size={15} />
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => removeLine(line.id)}
                          disabled={lines.length === 1}
                          className="rounded-md bg-rose-500 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          ลบ
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={addLine} className="rounded-md bg-leaf px-4 py-2 text-sm font-bold text-white">
              เพิ่มรายการ
            </button>
            <button className="focus-ring rounded-md bg-commit px-4 py-2 text-sm font-bold text-white hover:bg-commit/90">
              บันทึกบิล
            </button>
          </div>
        </section>

        {/* Sync status indicator */}
        {transaction && (
          <section className="p-3 sm:p-4">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-ink/70">สถานะ Sync:</span>
              <SyncStatusBadge status={transaction.syncStatus} />
              <span className="text-xs text-ink/50">{transaction.localBillNo}</span>
            </div>
          </section>
        )}

        <div className="modal-actions flex justify-end border-t border-black/10 p-4">
          <button type="button" onClick={() => void handleClose()} className="focus-ring h-11 rounded-md bg-actionSecondary px-4 font-semibold text-white hover:bg-actionSecondary/90">
            ยกเลิก
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
