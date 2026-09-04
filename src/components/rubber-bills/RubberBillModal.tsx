import { toast } from "sonner";
import { FileImage, Save, WifiOff } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  makeClientRecordedAt,
  makeClientTempId,
  makeIdempotencyKey,
  makeLocalBillNo,
  todayInputValue
} from "@/lib/format";
import { validateRubberBillDraft } from "@/lib/rubber-bill-validation";
import { calculateRubberBill } from "@/lib/rubber-bills/calculations";
import { useAcidProducts } from "@/hooks/useAcidProducts";
import { useAcidStock } from "@/hooks/useAcidStock";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { usePersistentFormDraft } from "@/hooks/usePersistentFormDraft";
import { appSwal } from "@/lib/swal";
import type { RubberBillOcrInitialDraft } from "@/hooks/useRubberBillOcrQueue";
import { openRubberBillOcrSourceImage } from "@/lib/rubber-bills/open-ocr-source-image";

import type { Location, Profile, RubberBill } from "@/types";
import { ModalShell } from "@/components/shared/ModalShell";

import { Field } from "@/components/shared/Field";
import { NumberField } from "@/components/shared/NumberField";
import { InlineRadio } from "@/components/shared/InlineRadio";
import { InlineNumber } from "@/components/shared/InlineNumber";

type RubberWeighItem = NonNullable<RubberBill["weighItems"]>[number];
type RubberStockDeductionItem = NonNullable<RubberBill["acidItems"]>[number];
type RubberDebtItem = NonNullable<RubberBill["debtItems"]>[number];
type RubberBillFormDraft = {
  billDate: string;
  customerSearch: string;
  selectedCustomerId: string | null;
  memberStatus: string;
  weighItems: RubberWeighItem[];
  stockDeductionItems: RubberStockDeductionItem[];
  debtItems: RubberDebtItem[];
  weightDeduct: number;
};
export type RubberBillCustomerOption = {
  id: string;
  mainName: string;
  legacyMemberId: string | null;
  farmAddress?: string | null;
};

export function RubberBillModal({
  selectedLocation,
  profile,
  bill,
  configuredPrice,
  priceTimeExempt = false,
  nonCurrentDateRequiresApproval = false,
  customers,
  initialOcrDraft,
  onClose,
  onSave
}: {
  selectedLocation: Location;
  profile: Profile;
  bill: RubberBill | null;
  configuredPrice?: number | null;
  priceTimeExempt?: boolean;
  nonCurrentDateRequiresApproval?: boolean;
  customers: RubberBillCustomerOption[];
  initialOcrDraft?: RubberBillOcrInitialDraft | null;
  onClose: () => void;
  onSave: (bill: RubberBill) => boolean | void | Promise<boolean | void>;
}) {
  const [draftClientTempId] = useState(() => bill?.clientTempId ?? makeClientTempId("rubber"));
  const initialLocalBillNo = bill?.localBillNo ?? makeLocalBillNo(selectedLocation.code, "R", draftClientTempId);
  const payerName = bill
    ? bill.createdByName?.trim() || "ไม่ระบุ"
    : profile.name?.trim() || "ไม่ระบุ";
  const [weighItems, setWeighItems] = useState<RubberWeighItem[]>(() => {
    if (bill?.weighItems?.length) return bill.weighItems;
    return [
      {
        id: makeClientTempId("weigh"),
        label: "ชั่ง1",
        inWeight: initialOcrDraft?.inWeight ?? 0,
        outWeight: initialOcrDraft?.outWeight ?? 0,
        netWeight: Math.max((initialOcrDraft?.inWeight ?? 0) - (initialOcrDraft?.outWeight ?? 0), 0),
        price: initialOcrDraft?.suggestedPrice ?? 0
      }
    ];
  });
  const [stockDeductionItems, setStockDeductionItems] = useState<RubberStockDeductionItem[]>(() => bill?.acidItems ?? []);
  const [debtItems, setDebtItems] = useState<RubberDebtItem[]>(() => bill?.debtItems ?? (bill?.debtItem ? [bill.debtItem] : []));
  const [weightDeduct, setWeightDeduct] = useState(bill?.deductWeight ?? initialOcrDraft?.deductWeight ?? 0);
  const [isWeightDeductOpen, setIsWeightDeductOpen] = useState(() => (bill?.deductWeight ?? initialOcrDraft?.deductWeight ?? 0) !== 0);
  const [billDate, setBillDate] = useState(bill?.billDate ?? initialOcrDraft?.billDate ?? todayInputValue());
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const validationSummaryRef = useRef<HTMLDivElement>(null);
  const { products: stockProducts } = useAcidProducts();
  const { movements: stockMovements, isLoading: isStockLoading, isError: isStockError } = useAcidStock(selectedLocation.id);
  const isOnline = useOnlineStatus();

  useEffect(() => {
    if (validationErrors.length === 0) return;
    validationSummaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [validationErrors]);

  // Autocomplete customer lookup states
  const [customerSearch, setCustomerSearch] = useState(bill?.customerName ?? "");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(bill?.customerId ?? null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [memberStatus, setMemberStatus] = useState(() => {
    if (!bill?.customerName) return "ไม่เป็นสมาชิก";
    const found = customers.some(c => c.mainName === bill.customerName);
    return found ? "สมาชิก" : "ไม่เป็นสมาชิก";
  });
  const draftValue = useMemo<RubberBillFormDraft>(() => ({
    billDate,
    customerSearch,
    selectedCustomerId,
    memberStatus,
    weighItems,
    stockDeductionItems,
    debtItems,
    weightDeduct,
  }), [
    billDate,
    customerSearch,
    debtItems,
    memberStatus,
    selectedCustomerId,
    stockDeductionItems,
    weighItems,
    weightDeduct,
  ]);
  const { clearDraft } = usePersistentFormDraft({
    partition: {
      ownerUserId: profile.id,
      locationId: selectedLocation.id,
      formType: "rubber-bill",
    },
    enabled: !bill && !initialOcrDraft,
    value: draftValue,
    onRestore: (draft) => {
      setBillDate(todayInputValue());
      setCustomerSearch(draft.customerSearch ?? "");
      setSelectedCustomerId(draft.selectedCustomerId ?? null);
      setMemberStatus(draft.memberStatus || "ไม่เป็นสมาชิก");
      if (Array.isArray(draft.weighItems) && draft.weighItems.length > 0) {
        setWeighItems(draft.weighItems);
      }
      if (Array.isArray(draft.stockDeductionItems)) {
        setStockDeductionItems(draft.stockDeductionItems);
      }
      if (Array.isArray(draft.debtItems)) setDebtItems(draft.debtItems);
      if (Number.isFinite(draft.weightDeduct)) {
        setWeightDeduct(draft.weightDeduct);
        setIsWeightDeductOpen(draft.weightDeduct !== 0);
      }
    },
  });

  const matchingCustomers = useMemo(() => {
    if (!customerSearch.trim()) return [];
    return customers.filter(c => {
      const nameMatch = c.mainName.toLowerCase().includes(customerSearch.toLowerCase());
      const idMatch = c.legacyMemberId?.toLowerCase().includes(customerSearch.toLowerCase());
      return nameMatch || idMatch;
    }).slice(0, 5);
  }, [customers, customerSearch]);

  const calculation = useMemo(
    () => calculateRubberBill({
      weighItems,
      deductWeight: weightDeduct,
      stockDeductionItems,
      debtItems,
    }),
    [debtItems, stockDeductionItems, weighItems, weightDeduct],
  );
  const hasPriceChange = !bill || (
    (bill.weighItems?.length ?? 0) !== weighItems.length
    || weighItems.some((item, index) =>
      Math.round(item.price * 100)
      !== Math.round((bill.weighItems?.[index]?.price ?? Number.NaN) * 100)
    )
  );
  const exceedsConfiguredPrice =
    hasPriceChange &&
    !priceTimeExempt &&
    configuredPrice != null &&
    weighItems.some((item) => Math.round(item.price * 100) > Math.round(configuredPrice * 100));
  const requiresNonCurrentDateApproval =
    nonCurrentDateRequiresApproval && billDate !== todayInputValue();

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
        price: 0
      }
    ]);
  }

  function removeWeighItem(id: string) {
    setWeighItems((current) => (current.length === 1 ? current : current.filter((item) => item.id !== id)));
  }

  function updateStockDeductionItem(id: string, patch: Partial<Omit<RubberStockDeductionItem, "id">>) {
    setStockDeductionItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function addStockDeductionItem() {
    if (!isOnline) {
      toast.error("หักสินค้าใช้ได้เมื่อออนไลน์ เพราะต้องตรวจยอดสต็อกก่อน");
      return;
    }

    if (stockProducts.length === 0) {
      toast.error("ยังไม่มีสินค้าในสต็อกให้เลือก");
      return;
    }

    const nextProduct = stockProducts.find((product) => !stockDeductionItems.some((item) => item.stockProductId === product.id)) ?? stockProducts[0];
    setStockDeductionItems((current) => {
      return [
        ...current,
        {
          id: makeClientTempId("stock"),
          name: nextProduct?.name ?? "",
          stockProductId: nextProduct?.id ?? "",
          quantity: 1,
          unit: nextProduct?.unit ?? "ชิ้น",
          unitPrice: 0
        }
      ];
    });
  }

  function removeStockDeductionItem(id: string) {
    setStockDeductionItems((current) => current.filter((item) => item.id !== id));
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

  async function submitForm(formElement: HTMLFormElement) {
    if (stockDeductionItems.length > 0 && !isOnline) {
      toast.error("หักสินค้าใช้ได้เมื่อออนไลน์ เพราะต้องตรวจยอดสต็อกก่อนบันทึก");
      return;
    }

    let submittedStockItems = stockDeductionItems;
    if (stockDeductionItems.length > 0) {
      if (isStockLoading) {
        toast.error("กำลังโหลดยอดสต็อก กรุณารอสักครู่แล้วบันทึกอีกครั้ง");
        return;
      }
      if (isStockError) {
        toast.error("ตรวจยอดสต็อกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        return;
      }

      const balanceByProduct = new Map<string, number>();
      for (const movement of stockMovements) {
        balanceByProduct.set(
          movement.productId,
          (balanceByProduct.get(movement.productId) ?? 0) + movement.quantityDelta,
        );
      }
      const oldQuantityByProduct = new Map<string, number>();
      for (const item of bill?.acidItems ?? []) {
        oldQuantityByProduct.set(
          item.stockProductId,
          (oldQuantityByProduct.get(item.stockProductId) ?? 0) + item.quantity,
        );
      }
      const requestedByProduct = new Map<string, { name: string; quantity: number }>();
      for (const item of stockDeductionItems) {
        const requested = requestedByProduct.get(item.stockProductId);
        requestedByProduct.set(item.stockProductId, {
          name: item.name,
          quantity: (requested?.quantity ?? 0) + item.quantity,
        });
      }
      const shortages = [...requestedByProduct.entries()].flatMap(([productId, requested]) => {
        const available = (balanceByProduct.get(productId) ?? 0)
          + (oldQuantityByProduct.get(productId) ?? 0);
        return requested.quantity > available
          ? [{ ...requested, available: Math.max(available, 0) }]
          : [];
      });

      if (shortages.length > 0) {
        const result = await appSwal.fire({
          title: "สินค้าในสต็อกไม่พอ",
          text: shortages
            .map((item) => `${item.name}: ต้องการ ${item.quantity} · คงเหลือ ${item.available}`)
            .join("\n"),
          icon: "warning",
          showCancelButton: true,
          confirmButtonText: "ยืนยันและลบรายการหักสินค้าทั้งหมด",
          cancelButtonText: "ยกเลิก",
          customClass: { htmlContainer: "whitespace-pre-line text-left text-pretty" },
        });
        if (!result.isConfirmed) return;
        submittedStockItems = [];
        setStockDeductionItems([]);
      }
    }

    const submitCalculation = submittedStockItems === stockDeductionItems
      ? calculation
      : calculateRubberBill({
          weighItems,
          deductWeight: weightDeduct,
          stockDeductionItems: submittedStockItems,
          debtItems,
        });

    const errors = validateRubberBillDraft({
      customerName: customerSearch,
      weighItems,
      deductWeight: weightDeduct,
      totalWeight: submitCalculation.totalWeight,
      acidItems: submittedStockItems,
      debtItems,
      netTotal: submitCalculation.netTotal,
    });

    if (errors.length > 0) {
      setValidationErrors(errors);
      toast.error(`พบข้อมูลที่ต้องแก้ไข ${errors.length} จุด`, {
        description: errors[0],
      });
      return;
    }

    setValidationErrors([]);

    const form = new FormData(formElement);
    const clientTempId = bill?.clientTempId ?? draftClientTempId;
    const clientRecordedAt = bill?.clientRecordedAt ?? makeClientRecordedAt();
    const localBillNo = String(form.get("billNo") || initialLocalBillNo);
    const saved = await onSave({
      id: bill?.id ?? clientTempId,
      clientTempId,
      localBillNo,
      serverBillNo: bill?.serverBillNo,
      syncStatus: bill?.syncStatus ?? "pending",
      idempotencyKey: bill?.idempotencyKey ?? makeIdempotencyKey("create", clientTempId),
      locationId: selectedLocation.id,
      billNo: bill?.serverBillNo ?? localBillNo,
      billDate,
      customerId: selectedCustomerId,
      customerName: customerSearch,
      billType: String(form.get("billType") || "บิลเครื่องชั่งเล็ก"),
      deductWeight: weightDeduct,
      weight: submitCalculation.totalWeight,
      netWeight: submitCalculation.netWeight,
      weighValueTotal: submitCalculation.weighValueTotal,
      rubberValue: submitCalculation.rubberValue,
      price: submitCalculation.averagePrice,
      deductionTotal: submitCalculation.deductionTotal,
      payableBeforeRounding: submitCalculation.payableBeforeRounding,
      netTotal: submitCalculation.netTotal,
      acidPackCount: submittedStockItems.reduce((sum, item) => sum + item.quantity, 0),
      configuredPriceSnapshot: bill?.configuredPriceSnapshot ?? configuredPrice ?? null,
      approvalState: bill?.approvalState ?? "not_required",
      approvalApprovedByName: bill?.approvalApprovedByName ?? null,
      approvalRevisionNo: bill?.approvalRevisionNo ?? null,
      weighItems,
      acidItems: submittedStockItems,
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
      recordStatus: bill?.recordStatus ?? "active",
      inputMethod: initialOcrDraft ? "ocr" : (bill?.inputMethod ?? "manual"),
      ocrUploadId: initialOcrDraft?.uploadId,
    });
    if (saved !== false && !bill && !initialOcrDraft) await clearDraft();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLockRef.current) return;
    const formElement = event.currentTarget;
    submitLockRef.current = true;
    setIsSubmitting(true);
    try {
      await submitForm(formElement);
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleClose() {
    if (submitLockRef.current) return;
    if (bill || initialOcrDraft) {
      onClose();
      return;
    }
    const hasDraftContent = Boolean(
      customerSearch.trim()
      || weightDeduct
      || stockDeductionItems.length
      || debtItems.length
      || weighItems.some((item) =>
        item.inWeight || item.outWeight || item.netWeight || item.price
      )
      || billDate !== todayInputValue()
    );
    if (
      hasDraftContent
      && !confirm("ยกเลิกและลบแบบร่างบิลยางนี้ใช่หรือไม่?")
    ) return;
    await clearDraft();
    onClose();
  }

  async function openOcrSourceImage() {
    if (!bill?.hasOcrSourceImage) return;
    try {
      await openRubberBillOcrSourceImage(bill.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "เปิดรูปต้นฉบับจาก OCR ไม่สำเร็จ");
    }
  }


  return (
    <ModalShell
      title={bill ? "แก้ไขบิลเครื่องชั่งเล็ก" : "บิลเครื่องชั่งเล็ก"}
      subtitle={selectedLocation.name}
      onClose={() => void handleClose()}
      closeDisabled={isSubmitting}
      size="wide"
    >
      <form onSubmit={handleSubmit} className="space-y-0" noValidate>
        {bill?.inputMethod === "ocr" && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-river/15 bg-river/5 p-3 text-sm text-river">
            <span className="font-semibold">เพิ่มด้วย OCR · รูปต้นฉบับนี้ไม่ใช่หลักฐานน้ำหนัก</span>
            {bill.hasOcrSourceImage && <button type="button" onClick={() => void openOcrSourceImage()} className="focus-ring inline-flex h-10 items-center gap-2 rounded-md border border-river/30 bg-white px-3 font-semibold text-river hover:bg-river/5"><FileImage size={16} aria-hidden="true" />เปิดรูปต้นฉบับ</button>}
          </div>
        )}
        {validationErrors.length > 0 && (
          <div
            ref={validationSummaryRef}
            role="alert"
            aria-live="assertive"
            className="border-b border-red-200 bg-red-50 p-4"
          >
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
            <Field
              label="วันที่"
              name="billDate"
              type="date"
              value={billDate}
              onChange={(event) => setBillDate(event.target.value)}
              required
            />
            {requiresNonCurrentDateApproval && (
              <p role="status" className="md:col-span-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                วันที่บิลไม่ใช่วันปัจจุบัน — รายการนี้จะถูกส่งขออนุมัติ
              </p>
            )}

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
                    setSelectedCustomerId(null);
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
                        setSelectedCustomerId(cust.id);
                        setMemberStatus("สมาชิก");
                        setShowDropdown(false);
                      }}
                      className="w-full px-4 py-2.5 text-left text-sm hover:bg-slate-100 border-b border-black/5 last:border-0 flex justify-between items-center"
                    >
                      <div>
                        <span className="font-semibold text-ink">{cust.mainName}</span>
                        {cust.farmAddress && <span className="text-xs text-ink/50 ml-2">({cust.farmAddress})</span>}
                      </div>
                      <span className="text-xs font-bold text-leaf bg-leaf/10 px-2 py-0.5 rounded">
                        {cust.legacyMemberId || "FSC"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="md:col-span-2">
              <Field label="ผู้รับผิดชอบการจ่าย" name="payerName" defaultValue={payerName} readOnly />
            </div>
            <input type="hidden" name="billType" value="บิลเครื่องชั่งเล็ก" />
          </div>
        </section>

        <section className="bg-mint/45 p-3 sm:p-4">
          <h3 className="mb-3 font-bold text-ink">ชั่งสินค้า</h3>
          {initialOcrDraft?.ocrTotal != null && Math.round(calculation.netTotal) !== Math.round(initialOcrDraft.ocrTotal) && (
            <p role="status" className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              ยอดจาก OCR {initialOcrDraft.ocrTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท ไม่ตรงกับยอดตามสูตรบิล {calculation.netTotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท — ระบบจะใช้ยอดตามสูตรบิล
            </p>
          )}
          {!priceTimeExempt && configuredPrice != null && (
            <div className={`mb-3 rounded-md border px-3 py-2 text-sm ${
              exceedsConfiguredPrice
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : "border-leaf/20 bg-leaf/5 text-leaf"
            }`}>
              ราคาต่ำกว่า {configuredPrice.toFixed(2)} บาท ไม่ต้องอนุมัติ
              {exceedsConfiguredPrice && " — บิลนี้จะเข้ารออนุมัติเมื่อบันทึก"}
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left">
                  <th className="py-2">รายการชั่ง</th>
                  <th>น้ำหนักเข้า</th>
                  <th>น้ำหนักออก</th>
                  <th>น้ำหนักชั่งสุทธิ</th>
                  <th>ราคาสินค้า</th>
                  <th>ยอดเงิน</th>
                  <th>ลบ</th>
                </tr>
              </thead>
              <tbody>
                {weighItems.map((item, index) => (
                  <tr key={item.id} className="border-b border-black/10">
                    <td className="py-2">
                      <input
                        value={item.label}
                        readOnly
                        className="focus-ring h-10 w-20 rounded-md border border-black/10 bg-white px-2 read-only:bg-slate-100 read-only:text-ink/70"
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
                    <td><InlineNumber value={calculation.lineTotals[index] ?? 0} readOnly /></td>
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
                {stockDeductionItems.map((item, index) => (
                  <tr key={item.id} className="border-b border-black/10">
                    <td className="py-2">
                      <select
                        value={item.stockProductId}
                        onChange={(event) => {
                          const product = stockProducts.find((nextProduct) => nextProduct.id === event.target.value);
                          updateStockDeductionItem(item.id, {
                            stockProductId: product?.id ?? "",
                            name: product?.name ?? "",
                            unit: product?.unit ?? item.unit
                          });
                        }}
                        className="focus-ring h-10 w-full rounded-md border border-black/10 bg-white px-3"
                        required
                      >
                        <option value="" disabled>เลือกสินค้าในสต็อก</option>
                        {stockProducts.map((product) => (
                          <option key={product.id} value={product.id}>{product.name}</option>
                        ))}
                      </select>
                    </td>
                    <td><InlineNumber value={item.quantity} onChange={(value) => updateStockDeductionItem(item.id, { quantity: value })} /></td>
                    <td>
                      <input
                        value={item.unit}
                        readOnly
                        className="focus-ring h-10 w-20 rounded-md border border-black/10 bg-white px-2 read-only:bg-slate-100 read-only:text-ink/70"
                      />
                    </td>
                    <td><InlineNumber value={item.unitPrice} onChange={(value) => updateStockDeductionItem(item.id, { unitPrice: value })} /></td>
                    <td><InlineNumber value={calculation.stockDeductionLineTotals[index] ?? 0} readOnly /></td>
                    <td>
                      <button type="button" onClick={() => removeStockDeductionItem(item.id)} className="rounded bg-rose-500 px-3 py-2 text-sm font-bold text-white">
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
            onClick={addStockDeductionItem}
            aria-disabled={!isOnline}
            className={`mt-3 inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-bold ${
              isOnline
                ? "bg-clay text-white hover:bg-clay/90"
                : "cursor-not-allowed bg-slate-300 text-white"
            }`}
          >
            {!isOnline && <WifiOff size={15} />}
            {isOnline ? "เพิ่มรายการหักสินค้า" : "กดได้เมื่อออนไลน์"}
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
                        readOnly
                        className="focus-ring h-10 w-full rounded-md border border-black/10 bg-white px-3 read-only:bg-slate-100 read-only:text-ink/70"
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
            className="mt-3 rounded-md bg-clay px-4 py-2 text-sm font-bold text-white hover:bg-clay/90"
          >
            เพิ่มหักเงิน
          </button>
        </section>

        <section className="grid gap-3 p-3 sm:w-48 sm:p-4">
          <button
            type="button"
            aria-expanded={isWeightDeductOpen}
            aria-controls="rubber-weight-deduction-field"
            onClick={() => {
              if (isWeightDeductOpen) {
                setWeightDeduct(0);
                setIsWeightDeductOpen(false);
                return;
              }
              setIsWeightDeductOpen(true);
            }}
            className="focus-ring h-11 w-fit rounded-md bg-clay px-3 text-sm font-semibold text-white hover:bg-clay/90"
          >
            {isWeightDeductOpen ? "ยกเลิกหักน้ำหนัก" : "หักน้ำหนักยาง"}
          </button>
          {isWeightDeductOpen && (
            <div id="rubber-weight-deduction-field">
              <NumberField
                label="หักน้ำหนักยาง (กก.)"
                value={weightDeduct}
                onChange={setWeightDeduct}
                autoFocus={weightDeduct === 0}
              />
            </div>
          )}
          <NumberField label="น้ำหนักสุทธิ (กก.)" value={calculation.netWeight} readOnly />
          <NumberField label="ราคาเฉลี่ย (บาท/กก.)" value={calculation.averagePrice} readOnly />
          <NumberField
            label="มูลค่ายาง (บาท)"
            value={calculation.rubberValue}
            readOnly
          />
          <NumberField label="ยอดหักเงิน (บาท)" value={calculation.deductionTotal} readOnly />
          <NumberField label="ยอดที่ต้องจ่ายลูกค้า (บาท)" value={calculation.netTotal} readOnly />
        </section>

        <div className="modal-actions flex justify-center border-t border-black/10 p-4">
          <button
            disabled={isSubmitting}
            className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-commit px-5 font-semibold text-white hover:bg-commit/90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Save size={18} />
            {isSubmitting
              ? "กำลังบันทึก..."
              : requiresNonCurrentDateApproval || exceedsConfiguredPrice
                ? "ส่งขออนุมัติ"
                : "บันทึกบิล"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
