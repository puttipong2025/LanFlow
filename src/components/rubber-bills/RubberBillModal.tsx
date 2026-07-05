import { toast } from "sonner";
import { Save } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

import {
  makeClientRecordedAt,
  makeClientTempId,
  makeIdempotencyKey,
  makeLocalBillNo,
  todayInputValue
} from "@/lib/format";
import { validateRubberBillDraft } from "@/lib/rubber-bill-validation";

import type { Customer, Location, PaymentResponsibility, Profile, RubberBill } from "@/types";
import { ModalShell } from "@/components/shared/ModalShell";
import { Field } from "@/components/shared/Field";
import { NumberField } from "@/components/shared/NumberField";
import { InlineRadio } from "@/components/shared/InlineRadio";
import { InlineNumber } from "@/components/shared/InlineNumber";

type RubberWeighItem = NonNullable<RubberBill["weighItems"]>[number];
type RubberAcidItem = NonNullable<RubberBill["acidItems"]>[number];
type RubberDebtItem = NonNullable<RubberBill["debtItems"]>[number];

export function RubberBillModal({
  selectedLocation,
  profile,
  bill,
  customers,
  onClose,
  onSave,
  onAddCustomer,
  onUpdateCustomer
}: {
  selectedLocation: Location;
  profile: Profile;
  bill: RubberBill | null;
  customers: Customer[];
  onClose: () => void;
  onSave: (bill: RubberBill) => void;
  onAddCustomer: (customer: Customer) => void;
  onUpdateCustomer: (customer: Customer) => void;
}) {
  const [clientTempId] = useState(() => bill?.clientTempId ?? makeClientTempId("rubber"));
  const initialLocalBillNo = bill?.localBillNo ?? makeLocalBillNo(selectedLocation.code, "R", clientTempId);
  const initialPaymentResponsibility = bill?.customerType ?? "สาขานี้จ่าย";
  const [weighItems, setWeighItems] = useState<RubberWeighItem[]>(() => {
    if (bill?.weighItems?.length) return bill.weighItems;
    return [
      {
        id: makeClientTempId("weigh"),
        label: "ชั่ง1",
        inWeight: 0,
        outWeight: 0,
        netWeight: bill?.weight ?? 0,
        price: bill?.price ?? 0
      }
    ];
  });
  const [acidItems, setAcidItems] = useState<RubberAcidItem[]>(() => bill?.acidItems ?? []);
  const [debtItems, setDebtItems] = useState<RubberDebtItem[]>(() => bill?.debtItems ?? (bill?.debtItem ? [bill.debtItem] : []));
  const [paymentResponsibility, setPaymentResponsibility] = useState<PaymentResponsibility>(initialPaymentResponsibility);
  const [weightDeduct, setWeightDeduct] = useState(0);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Autocomplete customer lookup states
  const [customerSearch, setCustomerSearch] = useState(bill?.customerName ?? "");
  const [showDropdown, setShowDropdown] = useState(false);
  const [memberStatus, setMemberStatus] = useState(() => {
    if (!bill?.customerName) return "ไม่เป็นสมาชิก";
    const found = customers.some(c => c.mainName === bill.customerName);
    return found ? "สมาชิก" : "ไม่เป็นสมาชิก";
  });

  const matchingCustomers = useMemo(() => {
    if (!customerSearch.trim()) return [];
    return customers.filter(c => {
      const nameMatch = c.mainName.toLowerCase().includes(customerSearch.toLowerCase());
      const idMatch = c.legacyMemberId?.toLowerCase().includes(customerSearch.toLowerCase());
      return nameMatch || idMatch;
    }).slice(0, 5);
  }, [customers, customerSearch]);

  const totalWeight = weighItems.reduce((sum, item) => sum + item.netWeight, 0);
  const gross = weighItems.reduce((sum, item) => sum + Math.floor(item.netWeight * item.price), 0);
  const averagePrice = totalWeight > 0 ? gross / totalWeight : 0;
  const acidDeduction = acidItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const debtDeduction = debtItems.reduce((sum, item) => sum + item.amount, 0);
  const weightDeductValue = weightDeduct * averagePrice;
  const deduct = acidDeduction + debtDeduction + weightDeductValue;
  const net = Math.max(gross - deduct, 0);
  const branchPayment = paymentResponsibility === "สาขานี้จ่าย" ? net : 0;
  const headOfficePayment = paymentResponsibility === "สาขาใหญ่จ่าย" ? net : 0;

  function updateWeighItem(id: string, patch: Partial<Omit<RubberWeighItem, "id">>) {
    setWeighItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const nextItem = { ...item, ...patch };
        if (!("inWeight" in patch) && !("outWeight" in patch)) {
          return nextItem;
        }
        return {
          ...nextItem,
          netWeight: Math.max(nextItem.inWeight - nextItem.outWeight, 0)
        };
      })
    );
  }

  function addWeighItem() {
    setWeighItems((current) => [
      ...current,
      {
        id: makeClientTempId("weigh"),
        label: `ชั่ง${current.length + 1}`,
        inWeight: 0,
        outWeight: 0,
        netWeight: 0,
        price: current.at(-1)?.price ?? 0
      }
    ]);
  }

  function removeWeighItem(id: string) {
    setWeighItems((current) => (current.length === 1 ? current : current.filter((item) => item.id !== id)));
  }

  function updateAcidItem(id: string, patch: Partial<Omit<RubberAcidItem, "id">>) {
    setAcidItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function addAcidItem() {
    const names = ["น้ำกรดตราเสือไฟท์", "น้ำกรดตรามังกรไฟท์"];
    setAcidItems((current) => {
      if (current.length >= 2) return current;
      return [
        ...current,
        {
          id: makeClientTempId("acid"),
          name: names[current.length],
          quantity: 1,
          unit: "แพ็ค",
          unitPrice: 0
        }
      ];
    });
  }

  function removeAcidItem(id: string) {
    setAcidItems((current) => current.filter((item) => item.id !== id));
  }

  function updateDebtItem(id: string, patch: Partial<Omit<RubberDebtItem, "id">>) {
    setDebtItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function addDebtItem() {
    setDebtItems((current) => [
      ...current,
      { id: makeClientTempId("debt"), title: `หักชำระหนี้ ${current.length + 1}`, amount: 0 }
    ]);
  }

  function removeDebtItem(id: string) {
    setDebtItems((current) => current.filter((item) => item.id !== id));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const errors = validateRubberBillDraft({
      customerName: customerSearch,
      weighItems,
      acidItems,
      debtItems,
      netTotal: net
    });

    if (errors.length > 0) {
      setValidationErrors(errors);
      toast.error("ข้อมูลไม่ถูกต้อง กรุณาแก้ไขข้อผิดพลาด");
      return;
    }
    
    setValidationErrors([]);

    const form = new FormData(event.currentTarget);
    const clientTempId = bill?.clientTempId ?? makeClientTempId("rubber");
    const clientRecordedAt = bill?.clientRecordedAt ?? makeClientRecordedAt();
    const localBillNo = String(form.get("billNo") || initialLocalBillNo);
    onSave({
      id: bill?.id ?? clientTempId,
      clientTempId,
      localBillNo,
      serverBillNo: bill?.serverBillNo,
      syncStatus: bill?.syncStatus ?? "pending",
      idempotencyKey: bill?.idempotencyKey ?? makeIdempotencyKey("create", clientTempId),
      locationId: selectedLocation.id,
      billNo: bill?.serverBillNo ?? localBillNo,
      billDate: String(form.get("billDate") || todayInputValue()),
      customerName: customerSearch,
      customerType: paymentResponsibility,
      billType: String(form.get("billType") || "บิลเครื่องชั่งเล็ก"),
      weight: totalWeight,
      price: averagePrice,
      deductionTotal: deduct,
      netTotal: net,
      cashPayment: branchPayment,
      transferPayment: headOfficePayment,
      acidPackCount: acidItems.reduce((sum, item) => sum + item.quantity, 0),
      weighItems,
      acidItems,
      debtItem: debtItems[0],
      debtItems,
      createdByUserId: bill?.createdByUserId ?? profile.id,
      createdByName: bill?.createdByName ?? profile.name,
      createdByPhone: bill?.createdByPhone ?? profile.phone,
      clientCreatedAt: bill?.clientCreatedAt ?? clientRecordedAt,
      serverCreatedAt: bill?.serverCreatedAt,
      clientRecordedAt,
      serverReceivedAt: bill?.serverReceivedAt,
      revisionNo: bill?.revisionNo ?? 0,
      recordStatus: bill?.recordStatus ?? "active"
    });
  }


  return (
    <ModalShell
      title={bill ? "แก้ไขบิลเครื่องชั่งเล็ก" : "บิลเครื่องชั่งเล็ก"}
      subtitle={selectedLocation.name}
      onClose={onClose}
      size="wide"
    >
      <form onSubmit={handleSubmit} className="space-y-0" noValidate>
        {validationErrors.length > 0 && (
          <div className="bg-red-50 p-4 border-b border-red-200">
            <h4 className="text-red-800 font-bold mb-2">ไม่สามารถบันทึกได้เนื่องจาก:</h4>
            <ul className="list-disc pl-5 text-sm text-red-700 space-y-1">
              {validationErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}
        <section className="bg-slate-50 p-3 sm:p-4">
          <h3 className="mb-4 font-bold text-ink">ข้อมูลลูกค้า</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="เลขบิลชั่วคราว" name="billNo" defaultValue={bill?.localBillNo ?? initialLocalBillNo} required readOnly />
            <Field label="วันที่" name="billDate" type="date" defaultValue={bill?.billDate ?? todayInputValue()} required />

            <div className="text-center md:col-span-1">
              <p className="mb-2 text-sm font-bold text-ink">สถานะสมาชิก</p>
              <div className="flex justify-center gap-4 text-sm font-semibold">
                <InlineRadio
                  name="memberStatus"
                  value="สมาชิก"
                  label="สมาชิก"
                  checked={memberStatus === "สมาชิก"}
                  onChange={() => setMemberStatus("สมาชิก")}
                />
                <InlineRadio
                  name="memberStatus"
                  value="ไม่เป็นสมาชิก"
                  label="ไม่เป็นสมาชิก"
                  checked={memberStatus === "ไม่เป็นสมาชิก"}
                  onChange={() => setMemberStatus("ไม่เป็นสมาชิก")}
                />
              </div>
            </div>

            <div className="relative">
              <label className="block">
                <span className="mb-1 block text-sm font-semibold text-ink/70">ชื่อลูกค้า *</span>
                <input
                  name="customerName"
                  value={customerSearch}
                  onChange={(e) => {
                    setCustomerSearch(e.target.value);
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  onBlur={() => {
                    setTimeout(() => setShowDropdown(false), 200);
                  }}
                  required
                  placeholder="ค้นหาชื่อ หรือ รหัสสมาชิก..."
                  className="focus-ring h-11 w-full rounded-md border border-black/10 bg-white px-3"
                  autoComplete="off"
                />
              </label>

              {showDropdown && matchingCustomers.length > 0 && (
                <div className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-md border border-black/10 bg-white shadow-lg">
                  {matchingCustomers.map(cust => (
                    <button
                      key={cust.id}
                      type="button"
                      onClick={() => {
                        setCustomerSearch(cust.mainName);
                        setMemberStatus("สมาชิก");
                        setPaymentResponsibility(cust.class);
                        setShowDropdown(false);
                      }}
                      className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-100 border-b border-black/5 last:border-0 flex justify-between items-center"
                    >
                      <div>
                        <span className="font-semibold text-ink">{cust.mainName}</span>
                        {cust.farms?.[0]?.address && <span className="text-xs text-ink/50 ml-2">({cust.farms[0].address})</span>}
                      </div>
                      <span className="text-xs font-bold text-leaf bg-leaf/10 px-2 py-0.5 rounded">
                        {cust.legacyMemberId || "FSC"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-center gap-2 md:col-span-2">
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
                  const name = window.prompt("กรอกชื่อสมาชิกใหม่:", customerSearch.trim());
                  if (name && name.trim()) {
                    newCust.mainName = name.trim();
                    newCust.id = makeClientTempId("cust");
                    newCust.clientTempId = newCust.id;
                    newCust.idempotencyKey = makeIdempotencyKey("create", newCust.id);
                    onAddCustomer(newCust);
                    setCustomerSearch(name.trim());
                    setMemberStatus("สมาชิก");
                    setPaymentResponsibility(newCust.class);
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
                  }
                }}
                className="rounded-md bg-amber px-3 py-2 text-sm font-semibold text-ink hover:bg-amber/80 transition-colors"
              >
                แก้ไขข้อมูลสมาชิกนี้
              </button>
            </div>

            <div className="text-center md:col-span-2">
              <p className="mb-2 text-sm font-bold text-ink">ผู้รับผิดชอบการจ่าย</p>
              <div className="flex justify-center gap-4 text-sm font-semibold">
                <InlineRadio
                  name="customerType"
                  value="สาขานี้จ่าย"
                  label="สาขานี้จ่าย"
                  checked={paymentResponsibility === "สาขานี้จ่าย"}
                  onChange={() => setPaymentResponsibility("สาขานี้จ่าย")}
                />
                <InlineRadio
                  name="customerType"
                  value="สาขาใหญ่จ่าย"
                  label="สาขาใหญ่จ่าย 40,000บาทขึ้นไป"
                  checked={paymentResponsibility === "สาขาใหญ่จ่าย"}
                  onChange={() => setPaymentResponsibility("สาขาใหญ่จ่าย")}
                />
              </div>
            </div>
            <input type="hidden" name="billType" value="บิลเครื่องชั่งเล็ก" />
          </div>
        </section>

        <section className="bg-emerald-50 p-3 sm:p-4">
          <h3 className="mb-3 font-bold text-ink">ชั่งสินค้า</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left">
                  <th className="py-2">รายการชั่ง</th>
                  <th>น้ำหนักเข้า</th>
                  <th>น้ำหนักออก</th>
                  <th>น้ำหนักสุทธิ</th>
                  <th>ราคาสินค้า</th>
                  <th>ยอดเงิน</th>
                  <th>ลบ</th>
                </tr>
              </thead>
              <tbody>
                {weighItems.map((item) => (
                  <tr key={item.id} className="border-b border-black/10">
                    <td className="py-2">
                      <input
                        value={item.label}
                        onChange={(event) => updateWeighItem(item.id, { label: event.target.value })}
                        className="focus-ring h-10 w-20 rounded-md border border-black/10 bg-white px-2"
                      />
                    </td>
                    <td><InlineNumber value={item.inWeight} onChange={(value) => updateWeighItem(item.id, { inWeight: value })} /></td>
                    <td><InlineNumber value={item.outWeight} onChange={(value) => updateWeighItem(item.id, { outWeight: value })} /></td>
                    <td><InlineNumber value={item.netWeight} readOnly /></td>
                    <td>
                      <InlineNumber
                        value={item.price}
                        onChange={(value) => updateWeighItem(item.id, { price: value })}
                        decimalOnBlur
                      />
                    </td>
                    <td><InlineNumber value={Math.floor(item.netWeight * item.price)} readOnly /></td>
                    <td>
                      <button
                        type="button"
                        onClick={() => removeWeighItem(item.id)}
                        disabled={weighItems.length === 1}
                        className="rounded bg-rose-500 px-3 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        ลบ
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <button type="button" onClick={addWeighItem} className="rounded-md bg-leaf px-4 py-2 text-sm font-bold text-white">
              เพิ่มรายการชั่ง
            </button>
            <div className="w-32">
              <NumberField label="หักน้ำหนักยาง (กก.)" value={weightDeduct} onChange={setWeightDeduct} />
            </div>
            <div className="w-36">
              <NumberField label="มูลค่าหักน้ำหนัก (บาท)" value={weightDeductValue} readOnly />
            </div>
          </div>
        </section>

        <section className="bg-amber-50 p-3 sm:p-4">
          <h3 className="mb-3 font-bold text-ink">หักสินค้า</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left">
                  <th className="py-2">รายการหัก</th>
                  <th>จำนวน</th>
                  <th>หน่วย</th>
                  <th>ราคาต่อหน่วย</th>
                  <th>ยอดเงิน</th>
                  <th>ลบ</th>
                </tr>
              </thead>
              <tbody>
                {acidItems.map((item) => (
                  <tr key={item.id} className="border-b border-black/10">
                    <td className="py-2">
                      <input
                        value={item.name}
                        onChange={(event) => updateAcidItem(item.id, { name: event.target.value })}
                        className="focus-ring h-10 w-full rounded-md border border-black/10 bg-white px-3"
                      />
                    </td>
                    <td><InlineNumber value={item.quantity} onChange={(value) => updateAcidItem(item.id, { quantity: value })} /></td>
                    <td>
                      <input
                        value={item.unit}
                        onChange={(event) => updateAcidItem(item.id, { unit: event.target.value })}
                        className="focus-ring h-10 w-20 rounded-md border border-black/10 bg-white px-2"
                      />
                    </td>
                    <td><InlineNumber value={item.unitPrice} onChange={(value) => updateAcidItem(item.id, { unitPrice: value })} /></td>
                    <td><InlineNumber value={item.quantity * item.unitPrice} readOnly /></td>
                    <td>
                      <button type="button" onClick={() => removeAcidItem(item.id)} className="rounded bg-rose-500 px-3 py-2 text-sm font-bold text-white">
                        ลบ
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            onClick={addAcidItem}
            disabled={acidItems.length >= 2}
            className="mt-3 rounded-md bg-amber px-4 py-2 text-sm font-bold text-ink disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-ink/50"
          >
            เพิ่มน้ำกรด
          </button>
        </section>

        <section className="bg-rose-50 p-3 sm:p-4">
          <h3 className="mb-3 font-bold text-ink">หักเงิน</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left">
                  <th className="py-2">รายการหนี้</th>
                  <th className="text-center">—</th>
                  <th className="text-center">—</th>
                  <th>ยอดเงิน</th>
                  <th>ลบ</th>
                </tr>
              </thead>
              <tbody>
                {debtItems.map((item) => (
                  <tr key={item.id} className="border-b border-black/10">
                    <td className="py-2">
                      <input
                        value={item.title}
                        onChange={(event) => updateDebtItem(item.id, { title: event.target.value })}
                        className="focus-ring h-10 w-full rounded-md border border-black/10 bg-white px-3"
                      />
                    </td>
                    <td className="text-center">—</td>
                    <td className="text-center">—</td>
                    <td><InlineNumber value={item.amount} onChange={(value) => updateDebtItem(item.id, { amount: value })} /></td>
                    <td>
                      <button type="button" onClick={() => removeDebtItem(item.id)} className="rounded bg-rose-500 px-3 py-2 text-sm font-bold text-white">
                        ลบ
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            onClick={addDebtItem}
            className="mt-3 rounded-md bg-slate-500 px-4 py-2 text-sm font-bold text-white"
          >
            หักหนี้
          </button>
        </section>

        <section className="grid gap-3 p-3 sm:w-48 sm:p-4">
          <NumberField label="ราคาเฉลี่ยยาง (บาท/กก.)" value={averagePrice} readOnly />
          <NumberField label="รวมมูลค่ายาง (บาท)" value={gross} readOnly />
          <NumberField label="ยอดรวมที่ถูกหัก (บาท)" value={deduct} readOnly />
          <NumberField label="ยอดสุทธิที่ต้องจ่ายลูกค้า (บาท)" value={net} readOnly />
          <NumberField label="สาขานี้จ่าย" value={branchPayment} readOnly />
          <NumberField label="สาขาใหญ่จ่าย" value={headOfficePayment} readOnly />
          <input type="hidden" name="cashPayment" value={branchPayment} />
          <input type="hidden" name="transferPayment" value={headOfficePayment} />
        </section>

        <div className="flex justify-center border-t border-black/10 p-4">
          <button className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-blue-600 px-5 font-semibold text-white">
            <Save size={18} />
            Submit
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
