import { toast } from "sonner";
import { FormEvent, useMemo, useState } from "react";

import {
  makeClientRecordedAt,
  makeClientTempId,
  makeIdempotencyKey,
  makeLocalBillNo,
  todayInputValue
} from "@/lib/format";

import type { Customer, IncomeExpense, Location, Profile } from "@/types";
import { useIncomeSaleItems } from "@/hooks/useIncomeSaleItems";
import { ModalShell } from "@/components/shared/ModalShell";
import { Field } from "@/components/shared/Field";
import { InlineRadio } from "@/components/shared/InlineRadio";
import { InlineNumber } from "@/components/shared/InlineNumber";
import { SyncStatusBadge } from "@/components/shared/SyncStatusBadge";

export function IncomeExpenseModal({
  selectedLocation,
  profile,
  type,
  transaction,
  nextNumber,
  nextLocalSequence,
  customers,
  onClose,
  onSave,
  onAddCustomer,
  onUpdateCustomer
}: {
  selectedLocation: Location;
  profile: Profile;
  type: "income" | "expense";
  transaction: IncomeExpense | null;
  nextNumber: string;
  nextLocalSequence: number;
  customers: Customer[];
  onClose: () => void;
  onSave: (transactions: IncomeExpense[]) => void;
  onAddCustomer: (customer: Customer) => void;
  onUpdateCustomer: (customer: Customer) => void;
}) {
  type CashLine = {
    id: string;
    title: string;
    unit: number;
    price: number;
    cost: number;
  };
  const initialLocalBillNo = transaction?.localBillNo ?? makeLocalBillNo(selectedLocation.code, type === "income" ? "I" : "E", nextLocalSequence);

  // Customer autocomplete states
  const [customerSearch, setCustomerSearch] = useState(transaction?.title ?? "");
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [selectedCustomerName, setSelectedCustomerName] = useState(transaction?.title ?? "");

  const matchingCustomers = useMemo(() => {
    if (!customerSearch.trim()) return [];
    return customers.filter(c => {
      const nameMatch = c.mainName.toLowerCase().includes(customerSearch.toLowerCase());
      const idMatch = c.legacyMemberId?.toLowerCase().includes(customerSearch.toLowerCase());
      return nameMatch || idMatch;
    }).slice(0, 5);
  }, [customers, customerSearch]);

  const [lines, setLines] = useState<CashLine[]>([
    {
      id: transaction?.clientTempId ?? makeClientTempId("cash_line"),
      title: transaction?.title ?? "",
      unit: Number(transaction?.unit || 0),
      price: transaction?.price ?? 0,
      cost: transaction?.cost ?? 0
    }
  ]);
  const label = type === "income" ? "รายรับ" : "ค่าใช้จ่าย";
  const [billOption, setBillOption] = useState<string>(transaction?.billOption ?? (type === "income" ? "รายรับ" : "ค่าใช้จ่าย"));
  const { items: saleItems } = useIncomeSaleItems();

  function updateLine(id: string, patch: Partial<Omit<CashLine, "id">>) {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((current) => [
      ...current,
      { id: makeClientTempId("cash_line"), title: "", unit: 0, price: 0, cost: 0 }
    ]);
  }

  function removeLine(id: string) {
    setLines((current) => (current.length === 1 ? current : current.filter((line) => line.id !== id)));
  }

  function getLineCost(line: CashLine) {
    if (billOption === "บิลขาย") return line.unit * line.price;
    return line.cost;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const filledLines = lines.filter((line) => {
      if (billOption === "บิลขาย") {
        return line.title.trim() && line.unit > 0 && line.price > 0;
      }
      return line.title.trim() && line.cost > 0;
    });

    if (filledLines.length === 0) {
      toast.error("กรุณาเพิ่มรายการและจำนวนเงิน/ราคาให้ถูกต้องอย่างน้อย 1 รายการ");
      return;
    }

    onSave(
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
          txDate: String(form.get("txDate") || todayInputValue()),
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
  }

  return (
    <ModalShell
      title="เพิ่ม/แก้ไข บิลเงินสด"
      subtitle={selectedLocation.name}
      onClose={onClose}
      size="wide"
    >
      <form onSubmit={handleSubmit} className="space-y-0">
        {/* Section: Customer data + bill info (like บิลเครื่องชั่งเล็ก) */}
        <section className="bg-slate-50 p-3 sm:p-4">
          <h3 className="mb-4 font-bold text-ink">ข้อมูลลูกค้า</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="เลขบิลชั่วคราว" name="localBillNo" defaultValue={transaction?.localBillNo ?? initialLocalBillNo} required readOnly />
            <Field label="เลขที่" name="number" defaultValue={transaction?.number ?? nextNumber} required readOnly />
            <Field label="วันที่" name="txDate" type="date" defaultValue={transaction?.txDate ?? todayInputValue()} required />

            {/* Customer autocomplete lookup */}
            <div className="relative">
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-ink/70">ชื่อลูกค้า / ผู้รับเงิน</span>
                <input
                  value={customerSearch}
                  onChange={(e) => {
                    setCustomerSearch(e.target.value);
                    setShowCustomerDropdown(true);
                  }}
                  onFocus={() => setShowCustomerDropdown(true)}
                  onBlur={() => {
                    setTimeout(() => setShowCustomerDropdown(false), 200);
                  }}
                  placeholder="ค้นหาชื่อ หรือ รหัสสมาชิก..."
                  className="focus-ring h-11 w-full rounded-md border border-black/10 bg-white px-3"
                  autoComplete="off"
                />
              </label>

              {showCustomerDropdown && matchingCustomers.length > 0 && (
                <div className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-md border border-black/10 bg-white shadow-lg">
                  {matchingCustomers.map(cust => (
                    <button
                      key={cust.id}
                      type="button"
                      onClick={() => {
                        setCustomerSearch(cust.mainName);
                        setSelectedCustomerName(cust.mainName);
                        setShowCustomerDropdown(false);
                      }}
                      className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-100 border-b border-black/5 last:border-0 flex justify-between items-center"
                    >
                      <div>
                        <span className="font-semibold text-ink">{cust.mainName}</span>
                        {cust.farms?.[0]?.address && <span className="text-xs text-ink/50 ml-2">({cust.farms[0].address})</span>}
                      </div>
                      <span className="text-xs font-bold text-leaf bg-leaf/10 px-2 py-0.5 rounded">
                        {cust.legacyMemberId || "สมาชิก"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Add new / Edit customer buttons */}
            <div className="flex flex-wrap items-end gap-2 md:col-span-2">
              <button
                type="button"
                onClick={() => {
                  const newCust: Customer = {
                    id: makeClientTempId("cust"),
                    clientTempId: makeClientTempId("cust"),
                    class: "สาขานี้จ่าย",
                    mainName: customerSearch.trim() || "",
                    defaultLocationId: selectedLocation.id,
                    syncStatus: "pending",
                    idempotencyKey: makeIdempotencyKey("create", makeClientTempId("cust")),
                    revisionNo: 0,
                    recordStatus: "active"
                  };
                  const name = window.prompt("กรอกชื่อสมาชิกใหม่ (รหัสสมาชิก 6 หลัก จะสร้างอัตโนมัติ):", customerSearch.trim());
                  if (name && name.trim()) {
                    newCust.mainName = name.trim();
                    newCust.id = makeClientTempId("cust");
                    newCust.clientTempId = newCust.id;
                    newCust.idempotencyKey = makeIdempotencyKey("create", newCust.id);
                    onAddCustomer(newCust);
                    setCustomerSearch(name.trim());
                    setSelectedCustomerName(name.trim());
                  }
                }}
                className="rounded-md bg-sky-500 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-600 transition-colors"
              >
                เพิ่มข้อมูลสมาชิกใหม่
              </button>
              <button
                type="button"
                onClick={() => {
                  const found = customers.find(c => c.mainName === customerSearch);
                  if (!found) {
                    toast.error("กรุณาเลือกลูกค้าจากรายการก่อน แล้วจึงกดแก้ไข");
                    return;
                  }
                  const newName = window.prompt("แก้ไขชื่อสมาชิก:", found.mainName);
                  if (newName && newName.trim() && newName.trim() !== found.mainName) {
                    onUpdateCustomer({ ...found, mainName: newName.trim() });
                    setCustomerSearch(newName.trim());
                    setSelectedCustomerName(newName.trim());
                  }
                }}
                className="rounded-md bg-amber px-3 py-2 text-sm font-semibold text-ink hover:bg-amber/80 transition-colors"
              >
                แก้ไขข้อมูลสมาชิกนี้
              </button>
              {selectedCustomerName && (
                <span className="rounded-full bg-leaf/10 px-3 py-1 text-xs font-bold text-leaf">
                  ลูกค้า: {selectedCustomerName}
                </span>
              )}
            </div>
          </div>
        </section>

        <section className="p-3 sm:p-4">
          <p className="mb-3 font-bold text-ink">รูปแบบ</p>
          <div className="flex flex-wrap gap-3 text-sm font-semibold text-ink">
            {(type === "income" ? ["รายรับ", "บิลขาย"] : ["ค่าใช้จ่าย"]).map((option) => (
              <InlineRadio
                key={option}
                name="billOption"
                value={option}
                label={option}
                checked={billOption === option}
                onChange={() => setBillOption(option)}
              />
            ))}
          </div>
        </section>

        <section className="bg-emerald-50 p-3 sm:p-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/80 text-left text-base font-bold text-ink">
                  <th className="px-2 py-2">รายการ</th>
                  {billOption === "บิลขาย" && <th className="px-2 py-2">จำนวน</th>}
                  {billOption === "บิลขาย" && <th className="px-2 py-2">ราคา</th>}
                  <th className="px-2 py-2">{label}</th>
                  <th className="px-2 py-2 text-center">ลบ</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} className="border-b border-black/10">
                    <td className="px-2 py-2">
                      {billOption === "บิลขาย" ? (
                        <select
                          value={line.title}
                          onChange={(event) => updateLine(line.id, { title: event.target.value })}
                          className="focus-ring h-10 w-full rounded-md border border-black/10 bg-white px-3"
                          required
                        >
                          <option value="" disabled>เลือกรหัสสินค้า</option>
                          {saleItems.map(item => (
                            <option key={item.id} value={item.name}>{item.name}</option>
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
                        <InlineNumber value={line.unit} onChange={(value) => updateLine(line.id, { unit: value })} />
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
                      <button
                        type="button"
                        onClick={() => removeLine(line.id)}
                        disabled={lines.length === 1}
                        className="rounded-md bg-rose-500 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        ลบ
                      </button>
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
            <button className="focus-ring rounded-md bg-blue-600 px-4 py-2 text-sm font-bold text-white">
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

        <div className="flex justify-end border-t border-black/10 p-4">
          <button type="button" onClick={onClose} className="focus-ring h-11 rounded-md bg-field px-4 font-semibold text-ink">
            ยกเลิก
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
