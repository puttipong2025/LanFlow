import { ArrowRightLeft, Check, Lock, PackagePlus, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { toast } from "sonner";

import { useAcidProducts } from "@/hooks/useAcidProducts";
import { useAcidStock } from "@/hooks/useAcidStock";
import { useIncomeSaleItems } from "@/hooks/useIncomeSaleItems";
import { useStockEntryApprovals } from "@/hooks/useStockEntryApprovals";
import { useStockProductApprovals } from "@/hooks/useStockProductApprovals";
import { useStockSyncRetry } from "@/hooks/useStockSyncRetry";
import { formatCurrency } from "@/lib/format";
import { canManageSystemFeatures } from "@/lib/permissions";
import type { AcidProduct, AcidStockMovement, IncomeSaleItem, Location, Profile, StockEntryApprovalRequest, StockProductApprovalRequest } from "@/types";
import { ModalShell } from "@/components/shared/ModalShell";
import { Field } from "@/components/shared/Field";
import { NumberField } from "@/components/shared/NumberField";

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function movementLabel(movement: AcidStockMovement) {
  if (movement.sourceType === "income_sale") return "ขายจากรับ-จ่าย";
  if (movement.sourceType === "rubber_bill_acid" || movement.sourceType === "rubber_bill_stock_deduction") return "หักจากบิลยาง";
  if (movement.txType === "receive") return "รับเข้า";
  if (movement.txType === "transfer_out") return "ย้ายออก";
  if (movement.txType === "transfer_in") return "ย้ายเข้า";
  return movement.txType;
}

function quantityTone(quantity: number) {
  if (quantity > 0) return "text-leaf";
  if (quantity < 0) return "text-clay";
  return "text-ink";
}

function approvalRequestTypeLabel(request: StockProductApprovalRequest) {
  return request.requestType === "create_product" ? "เพิ่มสินค้า" : "ลบสินค้า";
}

function approvalRequestDetail(request: StockProductApprovalRequest) {
  if (request.requestType === "create_product") {
    return `${request.productName} / ${request.unit || "ชิ้น"}${request.createSaleItem ? " / เปิดขายในบิลขาย" : ""}`;
  }
  return request.productName;
}

function stockEntryApprovalDetail(request: StockEntryApprovalRequest) {
  if (request.txType === "transfer_out") {
    return `${request.productName} ${request.quantity.toLocaleString("th-TH")} / ${request.locationName} ไป ${request.targetLocationName || "ปลายทาง"}`;
  }
  return `${request.productName} ${request.quantity.toLocaleString("th-TH")} / ${request.locationName}`;
}

type PendingApprovalRow =
  | {
      kind: "product";
      id: string;
      createdAt: string;
      typeLabel: string;
      detail: string;
      requestedByName: string;
      requestedByPhone: string;
      request: StockProductApprovalRequest;
    }
  | {
      kind: "entry";
      id: string;
      createdAt: string;
      typeLabel: string;
      detail: string;
      requestedByName: string;
      requestedByPhone: string;
      request: StockEntryApprovalRequest;
    };

function ReceiveModal({
  location,
  products,
  online,
  onClose,
  onSave,
}: {
  location: Location;
  products: AcidProduct[];
  online: boolean;
  onClose: () => void;
  onSave: (input: { productId: string; txDate: string; quantity: number; amount: number }) => Promise<void>;
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [amount, setAmount] = useState(0);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!online) {
      toast.error("รับเข้าสต็อกใช้ได้เมื่อออนไลน์ เพราะต้องตรวจยอดสินค้า");
      return;
    }
    const form = new FormData(event.currentTarget);
    if (!productId || quantity <= 0) {
      toast.error("กรุณาเลือกสินค้าและระบุจำนวนให้ถูกต้อง");
      return;
    }

    try {
      await onSave({
        productId,
        txDate: String(form.get("txDate") || todayInputValue()),
        quantity,
        amount,
      });
      toast.success("รับเข้าสต็อกแล้ว");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "รับเข้าสต็อกไม่สำเร็จ");
    }
  }

  return (
    <ModalShell title="รับเข้าสต็อก" subtitle={location.name} onClose={onClose} size="normal">
      <form onSubmit={handleSubmit} className="space-y-4 p-4">
        <Field label="วันที่" name="txDate" type="date" defaultValue={todayInputValue()} required />
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink/70">สินค้า</span>
          <select
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            className="focus-ring h-11 w-full rounded-md border border-black/10 bg-white px-3"
            required
          >
            {products.map((product) => (
              <option key={product.id} value={product.id}>{product.name}</option>
            ))}
          </select>
        </label>
        <NumberField label="จำนวน" value={quantity} onChange={setQuantity} />
        <NumberField label="ยอดเงิน" value={amount} onChange={setAmount} />
        <div className="flex justify-end gap-2 border-t border-black/10 pt-4">
          <button type="button" onClick={onClose} className="focus-ring h-11 rounded-md bg-field px-4 font-semibold text-ink">
            ยกเลิก
          </button>
          <button disabled={!online} className="focus-ring h-11 rounded-md bg-leaf px-4 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300">
            บันทึก
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function TransferModal({
  location,
  locations,
  products,
  balances,
  online,
  onClose,
  onSave,
}: {
  location: Location;
  locations: Location[];
  products: AcidProduct[];
  balances: Map<string, number>;
  online: boolean;
  onClose: () => void;
  onSave: (input: { productId: string; toLocationId: string; txDate: string; quantity: number }) => Promise<void>;
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [toLocationId, setToLocationId] = useState(locations.find((item) => item.id !== location.id)?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const balance = balances.get(productId) ?? 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!online) {
      toast.error("ย้ายสต็อกใช้ได้เมื่อออนไลน์ เพราะต้องตรวจยอดสินค้า");
      return;
    }
    const form = new FormData(event.currentTarget);
    if (!productId || !toLocationId || quantity <= 0) {
      toast.error("กรุณาเลือกสินค้า สาขาปลายทาง และจำนวนให้ถูกต้อง");
      return;
    }
    if (quantity > balance) {
      toast.error("จำนวนย้ายมากกว่ายอดคงเหลือ");
      return;
    }

    try {
      await onSave({
        productId,
        toLocationId,
        txDate: String(form.get("txDate") || todayInputValue()),
        quantity,
      });
      toast.success("ย้ายสต็อกแล้ว");
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ย้ายสต็อกไม่สำเร็จ");
    }
  }

  return (
    <ModalShell title="ย้ายสต็อก" subtitle={location.name} onClose={onClose} size="normal">
      <form onSubmit={handleSubmit} className="space-y-4 p-4">
        <Field label="วันที่" name="txDate" type="date" defaultValue={todayInputValue()} required />
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink/70">สินค้า</span>
          <select
            value={productId}
            onChange={(event) => setProductId(event.target.value)}
            className="focus-ring h-11 w-full rounded-md border border-black/10 bg-white px-3"
            required
          >
            {products.map((product) => (
              <option key={product.id} value={product.id}>{product.name}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink/70">ไปสาขา</span>
          <select
            value={toLocationId}
            onChange={(event) => setToLocationId(event.target.value)}
            className="focus-ring h-11 w-full rounded-md border border-black/10 bg-white px-3"
            required
          >
            {locations.filter((item) => item.id !== location.id).map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <div className="rounded-md bg-field p-3 text-sm font-semibold text-ink">
          คงเหลือปัจจุบัน: <span className="text-leaf">{balance.toLocaleString("th-TH")}</span>
        </div>
        <NumberField label="จำนวนย้าย" value={quantity} onChange={setQuantity} />
        <div className="flex justify-end gap-2 border-t border-black/10 pt-4">
          <button type="button" onClick={onClose} className="focus-ring h-11 rounded-md bg-field px-4 font-semibold text-ink">
            ยกเลิก
          </button>
          <button disabled={!online} className="focus-ring h-11 rounded-md bg-river px-4 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300">
            บันทึก
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ProductModal({
  products,
  saleItems,
  isSaleItemsLoading,
  online,
  onClose,
  onSave,
  onAddSaleItem,
  onEnableSaleItem,
  onDisableSaleItem,
  onUpdateSaleItemStockProduct,
  onDeleteProduct,
}: {
  products: AcidProduct[];
  saleItems: IncomeSaleItem[];
  isSaleItemsLoading: boolean;
  online: boolean;
  onClose: () => void;
  onSave: (input: { name: string; unit: string; createSaleItem: boolean }) => Promise<unknown>;
  onAddSaleItem: (input: { name: string; stockProductId: string }) => Promise<unknown>;
  onEnableSaleItem: (id: string) => Promise<unknown>;
  onDisableSaleItem: (id: string) => Promise<unknown>;
  onUpdateSaleItemStockProduct: (input: { id: string; stockProductId: string }) => Promise<unknown>;
  onDeleteProduct: (input: { productId: string }) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("ชิ้น");
  const [createSaleItem, setCreateSaleItem] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [changingProductId, setChangingProductId] = useState<string | null>(null);

  const saleItemByProductId = useMemo(() => {
    const next = new Map<string, IncomeSaleItem>();
    for (const item of saleItems) {
      if (!item.stockProductId) continue;
      const existing = next.get(item.stockProductId);
      if (!existing || (!existing.isActive && item.isActive)) {
        next.set(item.stockProductId, item);
      }
    }
    return next;
  }, [saleItems]);

  const saleItemByName = useMemo(() => {
    const next = new Map<string, IncomeSaleItem>();
    for (const item of saleItems) {
      next.set(item.name.trim().toLocaleLowerCase("th-TH"), item);
    }
    return next;
  }, [saleItems]);

  async function ensureSaleItemForProduct(product: AcidProduct) {
    const existingByProduct = saleItemByProductId.get(product.id);
    if (existingByProduct) {
      if (!existingByProduct.isActive) await onEnableSaleItem(existingByProduct.id);
      return;
    }

    const existingByName = saleItemByName.get(product.name.trim().toLocaleLowerCase("th-TH"));
    if (existingByName) {
      await onUpdateSaleItemStockProduct({ id: existingByName.id, stockProductId: product.id });
      if (!existingByName.isActive) await onEnableSaleItem(existingByName.id);
      return;
    }

    await onAddSaleItem({ name: product.name, stockProductId: product.id });
  }

  async function handleSaleStatusChange(product: AcidProduct, shouldSell: boolean) {
    if (!online) {
      toast.error("จัดการสินค้าสต็อกใช้ได้เมื่อออนไลน์เท่านั้น");
      return;
    }
    const saleItem = saleItemByProductId.get(product.id);
    try {
      setChangingProductId(product.id);
      if (shouldSell) {
        await ensureSaleItemForProduct(product);
        toast.success("เปิดขายในบิลขายแล้ว");
      } else if (saleItem) {
        await onDisableSaleItem(saleItem.id);
        toast.success("ปิดขายในบิลขายแล้ว");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "อัปเดตสถานะขายไม่สำเร็จ");
    } finally {
      setChangingProductId(null);
    }
  }

  async function handleDeleteProduct(product: AcidProduct) {
    if (!online) {
      toast.error("ลบสินค้าได้เมื่อออนไลน์เท่านั้น");
      return;
    }
    const confirmed = window.confirm(`ส่งคำขอลบสินค้า "${product.name}" หรือไม่?`);
    if (!confirmed) return;

    try {
      setChangingProductId(product.id);
      await onDeleteProduct({ productId: product.id });
      toast.success("ส่งคำขอลบสินค้าแล้ว รอผู้จัดการระบบอนุมัติ");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ส่งคำขอลบสินค้าไม่สำเร็จ");
    } finally {
      setChangingProductId(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!online) {
      toast.error("เพิ่มสินค้าใช้ได้เมื่อออนไลน์เท่านั้น");
      return;
    }
    if (!name.trim()) {
      toast.error("กรุณาระบุชื่อสินค้า");
      return;
    }

    try {
      setIsSaving(true);
      await onSave({ name: name.trim(), unit: unit.trim() || "ชิ้น", createSaleItem });
      toast.success("ส่งคำขอเพิ่มสินค้าแล้ว รอผู้จัดการระบบอนุมัติ");
      setName("");
      setUnit("ชิ้น");
      setCreateSaleItem(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "เพิ่มสินค้าไม่สำเร็จ");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <ModalShell title="เพิ่มสินค้า" subtitle="สร้างสินค้าและกำหนดการขายผ่านบิลขายในที่เดียว" onClose={onClose} size="wide">
      <form onSubmit={handleSubmit} className="space-y-4 p-4">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink/70">ชื่อสินค้า</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="focus-ring h-11 w-full rounded-md border border-black/10 bg-white px-3"
            placeholder="เช่น น้ำกรด, ถุงมือ, อุปกรณ์..."
            disabled={isSaving || !online}
            required
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink/70">หน่วย</span>
          <input
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            className="focus-ring h-11 w-full rounded-md border border-black/10 bg-white px-3"
            placeholder="ชิ้น"
            disabled={isSaving || !online}
          />
        </label>
        <label className="flex items-start gap-3 rounded-md border border-black/10 bg-field/60 p-3 text-sm font-semibold text-ink">
          <input
            type="checkbox"
            checked={createSaleItem}
            onChange={(event) => setCreateSaleItem(event.target.checked)}
            className="mt-1 h-4 w-4 accent-ink"
            disabled={isSaving || !online}
          />
          <span>
            ขายในบิลขาย
            <span className="block text-xs font-medium text-ink/60">เปิดไว้แล้วสินค้านี้จะขึ้นใน dropdown บิลขายทันที</span>
          </span>
        </label>
        <div className="flex justify-end gap-2 border-t border-black/10 pt-4">
          <button type="button" onClick={onClose} className="focus-ring h-11 rounded-md bg-field px-4 font-semibold text-ink">
            ยกเลิก
          </button>
          <button disabled={isSaving || !online} className="focus-ring h-11 rounded-md bg-ink px-4 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300">
            บันทึก
          </button>
        </div>
      </form>
      <div className="border-t border-black/10 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="font-bold text-ink">ขายผ่านบิลขาย</h3>
          <p className="text-xs font-semibold text-ink/50">อ้างอิงจากสินค้าสต็อก ไม่สร้างสินค้าแยก</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-ink/60">
                <th className="py-2">สินค้า</th>
                <th>หน่วย</th>
                <th>สถานะบิลขาย</th>
                <th className="text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {products.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-ink/50">ยังไม่มีสินค้าในสต็อก</td>
                </tr>
              ) : (
                products.map((product) => {
                  const saleItem = saleItemByProductId.get(product.id);
                  const isChanging = changingProductId === product.id;
                  return (
                    <tr key={product.id} className="border-b border-black/5">
                      <td className="py-3 font-semibold text-ink">{product.name}</td>
                      <td className="text-ink/60">{product.unit}</td>
                      <td>
                        {isSaleItemsLoading ? (
                          <span className="text-ink/50">กำลังโหลด...</span>
                        ) : saleItem?.isActive ? (
                          <span className="rounded-full bg-leaf/10 px-2 py-1 text-xs font-bold text-leaf">เปิดขาย</span>
                        ) : saleItem ? (
                          <span className="rounded-full bg-ink/10 px-2 py-1 text-xs font-bold text-ink/60">ปิดขาย</span>
                        ) : (
                          <span className="rounded-full bg-clay/10 px-2 py-1 text-xs font-bold text-clay">ยังไม่ขาย</span>
                        )}
                      </td>
                      <td>
                        <div className="flex justify-end gap-2">
                          {saleItem?.isActive ? (
                            <button
                              type="button"
                              onClick={() => handleSaleStatusChange(product, false)}
                              disabled={isChanging || isSaleItemsLoading || !online}
                              className="focus-ring h-9 rounded-md bg-field px-3 text-xs font-bold text-ink disabled:opacity-50"
                            >
                              ปิดขาย
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleSaleStatusChange(product, true)}
                              disabled={isChanging || isSaleItemsLoading || !online}
                              className="focus-ring h-9 rounded-md bg-ink px-3 text-xs font-bold text-white disabled:opacity-50"
                            >
                              เปิดขาย
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteProduct(product)}
                            disabled={isChanging || !online}
                            className="focus-ring inline-flex h-9 items-center gap-1 rounded-md bg-clay px-3 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                            title={online ? "ส่งคำขอลบสินค้า" : "ลบสินค้าได้เมื่อออนไลน์เท่านั้น"}
                          >
                            <Trash2 size={14} />
                            ลบ
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </ModalShell>
  );
}

export function AcidStockModule({
  selectedLocation,
  profile,
  locations,
  online,
}: {
  selectedLocation: Location;
  profile: Profile;
  locations: Location[];
  online: boolean;
}) {
  const { products, addProduct, deleteProduct } = useAcidProducts();
  const {
    items: saleItems,
    isLoading: saleItemsLoading,
    addItem: addSaleItem,
    enableItem: enableSaleItem,
    disableItem: disableSaleItem,
    updateStockProduct: updateSaleItemStockProduct,
  } = useIncomeSaleItems({ includeInactive: true });
  const { movements, isLoading, receiveStock, transferStock, deleteStockEntry } = useAcidStock(selectedLocation.id);
  const { requests: productApprovalRequests, isLoading: productApprovalsLoading, decideRequest: decideProductRequest } = useStockProductApprovals({ includeRequests: true });
  const { requests: entryApprovalRequests, isLoading: entryApprovalsLoading, decideRequest: decideEntryRequest } = useStockEntryApprovals({ includeRequests: true });
  const { retryStockSync, isRetrying } = useStockSyncRetry(selectedLocation.id, profile.id);
  const canManageSystem = canManageSystemFeatures(profile);
  const offlineActionTitle = online ? undefined : "ใช้ได้เมื่อออนไลน์ เพราะต้องตรวจยอดสต็อกล่าสุด";
  const [productOpen, setProductOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const balances = useMemo(() => {
    const next = new Map<string, number>();
    for (const movement of movements) {
      next.set(movement.productId, (next.get(movement.productId) ?? 0) + movement.quantityDelta);
    }
    return next;
  }, [movements]);

  const productSummaries = products.map((product) => ({
    product,
    balance: balances.get(product.id) ?? 0,
  }));

  const approvalsLoading = productApprovalsLoading || entryApprovalsLoading;
  const pendingApprovalRequests: PendingApprovalRow[] = [
    ...productApprovalRequests
      .filter((request) => request.requestStatus === "pending")
      .map((request): PendingApprovalRow => ({
        kind: "product",
        id: request.id,
        createdAt: request.createdAt,
        typeLabel: approvalRequestTypeLabel(request),
        detail: approvalRequestDetail(request),
        requestedByName: request.requestedByName,
        requestedByPhone: request.requestedByPhone,
        request,
      })),
    ...entryApprovalRequests
      .filter((request) => request.requestStatus === "pending")
      .map((request): PendingApprovalRow => ({
        kind: "entry",
        id: request.id,
        createdAt: request.createdAt,
        typeLabel: request.txType === "transfer_out" ? "ลบรายการย้ายสต็อก" : "ลบรายการรับเข้า",
        detail: stockEntryApprovalDetail(request),
        requestedByName: request.requestedByName,
        requestedByPhone: request.requestedByPhone,
        request,
      })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  async function handleRetryStockSync() {
    if (!online) {
      toast.error("ซิงก์รายการได้เมื่อออนไลน์เท่านั้น");
      return;
    }

    try {
      const result = await retryStockSync();
      if (result.attempted === 0) {
        toast.info("ไม่มีรายการขายหรือหักสินค้าที่รอซิงก์");
        return;
      }
      if (result.stopped) {
        toast.error(result.errorMessage || "หยุดซิงก์ เพราะรายการนี้ทำให้สต็อกติดลบ");
        return;
      }
      toast.success(`ซิงก์รายการสำเร็จ ${result.synced.toLocaleString("th-TH")} รายการ`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ซิงก์รายการไม่สำเร็จ");
    }
  }

  async function handleDeleteStockMovement(movement: AcidStockMovement) {
    if (!online) {
      toast.error("ลบรายการสต็อกได้เมื่อออนไลน์เท่านั้น");
      return;
    }
    if (movement.sourceType !== "stock_entry" || movement.txType === "transfer_in") {
      toast.error("ลบได้เฉพาะรายการรับเข้า หรือฝั่งย้ายออก");
      return;
    }

    const detail = movement.txType === "transfer_out"
      ? `ส่งคำขอลบรายการย้ายสต็อก ${movement.displayBillNo} หรือไม่? ระบบจะลบทั้งฝั่งย้ายออกและย้ายเข้า`
      : `ส่งคำขอลบรายการรับเข้า ${movement.displayBillNo} หรือไม่?`;
    if (!window.confirm(detail)) return;

    try {
      await deleteStockEntry({ stockEntryId: movement.sourceId });
      toast.success("ส่งคำขอลบรายการสต็อกแล้ว รอผู้จัดการระบบอนุมัติ");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ส่งคำขอลบรายการสต็อกไม่สำเร็จ");
    }
  }

  async function handleDecideApproval(request: PendingApprovalRow, decision: "approved" | "rejected") {
    if (!online) {
      toast.error("อนุมัติหรือปฏิเสธได้เมื่อออนไลน์เท่านั้น");
      return;
    }

    try {
      if (request.kind === "entry") {
        await decideEntryRequest({ id: request.id, decision });
      } else {
        await decideProductRequest({ id: request.id, decision });
      }
      toast.success(decision === "approved" ? "อนุมัติคำขอแล้ว" : "ปฏิเสธคำขอแล้ว");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ดำเนินการคำขอไม่สำเร็จ");
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 rounded-md border border-black/10 bg-white p-4 shadow-panel lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-bold text-ink">สต็อกสินค้า · {selectedLocation.name}</h2>
          <p className="text-sm text-ink/60">ยอดคงเหลือรวมรายการรับเข้า ย้าย บิลขาย และหักจากบิลยาง</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            onClick={handleRetryStockSync}
            disabled={!online || isRetrying}
            title={offlineActionTitle}
            className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-field px-4 font-semibold text-ink disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-white"
          >
            <RefreshCw size={18} className={isRetrying ? "animate-spin" : undefined} />
            ซิงก์รายการ
          </button>
          {canManageSystem && (
            <button
              type="button"
              onClick={() => setProductOpen(true)}
              disabled={!online}
              title={offlineActionTitle}
              className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-ink px-4 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Plus size={18} />
              เพิ่มสินค้า
            </button>
          )}
          <button
            type="button"
            onClick={() => setReceiveOpen(true)}
            disabled={products.length === 0 || !online}
            title={products.length === 0 ? "ยังไม่มีสินค้าในสต็อก" : offlineActionTitle}
            className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-leaf px-4 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <PackagePlus size={18} />
            รับเข้า
          </button>
          <button
            type="button"
            onClick={() => setTransferOpen(true)}
            disabled={products.length === 0 || locations.length < 2 || !online}
            title={products.length === 0 || locations.length < 2 ? "ต้องมีสินค้าและสาขาปลายทางก่อน" : offlineActionTitle}
            className="focus-ring flex h-11 items-center justify-center gap-2 rounded-md bg-river px-4 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <ArrowRightLeft size={18} />
            ย้ายสต็อก
          </button>
        </div>
      </div>

      {(canManageSystem || approvalsLoading || pendingApprovalRequests.length > 0) && (
        <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="font-bold text-ink">รายการรออนุมัติ</h3>
            <p className="text-xs font-semibold text-ink/50">เพิ่มสินค้าและลบสินค้าต้องให้ผู้จัดการระบบอนุมัติก่อน</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-black/10 text-left text-ink/60">
                  <th className="py-2">วันที่</th>
                  <th>ประเภท</th>
                  <th>สินค้า</th>
                  <th>ผู้ขอ</th>
                  <th className="text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {approvalsLoading ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-ink/50">กำลังโหลด...</td>
                  </tr>
                ) : pendingApprovalRequests.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-ink/50">ไม่มีรายการรออนุมัติ</td>
                  </tr>
                ) : (
                  pendingApprovalRequests.map((approval) => (
                    <tr key={`${approval.kind}:${approval.id}`} className="border-b border-black/5">
                      <td className="py-3">{new Date(approval.createdAt).toLocaleString("th-TH")}</td>
                      <td>
                        <span className="rounded-full bg-ink/10 px-2 py-1 text-xs font-bold text-ink/70">
                          {approval.typeLabel}
                        </span>
                      </td>
                      <td className="font-semibold text-ink">{approval.detail}</td>
                      <td>{approval.requestedByName || "ระบบ"} {approval.requestedByPhone ? `• ${approval.requestedByPhone}` : ""}</td>
                      <td className="text-right">
                        {canManageSystem ? (
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleDecideApproval(approval, "approved")}
                              disabled={!online}
                              className="focus-ring inline-flex h-9 items-center gap-1 rounded-md bg-leaf px-3 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                            >
                              <Check size={14} />
                              อนุมัติ
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDecideApproval(approval, "rejected")}
                              disabled={!online}
                              className="focus-ring inline-flex h-9 items-center gap-1 rounded-md bg-field px-3 text-xs font-bold text-ink disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-white"
                            >
                              <X size={14} />
                              ปฏิเสธ
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs font-semibold text-ink/50">รอผู้จัดการระบบ</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {productSummaries.map(({ product, balance }) => (
          <div key={product.id} className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
            <p className="text-sm font-semibold text-ink/60">{product.name}</p>
            <p className={`mt-2 text-3xl font-bold ${quantityTone(balance)}`}>{balance.toLocaleString("th-TH")}</p>
            <p className="mt-1 text-xs font-semibold text-ink/50">{product.unit}</p>
          </div>
        ))}
      </section>

      <section className="rounded-md border border-black/10 bg-white p-4 shadow-panel">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1220px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-black/10 text-left text-ink/60">
                <th className="py-2">วันที่</th>
                <th>เลขบิล</th>
                <th>สินค้า</th>
                <th>ประเภท</th>
                <th className="text-right">จำนวน</th>
                <th className="text-right">ยอดเงิน</th>
                <th>ผู้บันทึก</th>
                <th>สถานะ</th>
                <th className="text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-ink/50">กำลังโหลด...</td>
                </tr>
              ) : movements.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-ink/50">ยังไม่มีรายการสต็อก</td>
                </tr>
              ) : (
                movements.map((movement) => (
                  <tr key={movement.movementId} className="border-b border-black/5 hover:bg-field/50">
                    <td className="py-3">{movement.txDate}</td>
                    <td className="font-semibold">{movement.displayBillNo}</td>
                    <td>{movement.productName}</td>
                    <td>{movementLabel(movement)}</td>
                    <td className={`text-right font-bold ${quantityTone(movement.quantityDelta)}`}>
                      {movement.quantityDelta > 0 ? "+" : ""}{movement.quantityDelta.toLocaleString("th-TH")}
                    </td>
                    <td className="text-right">{formatCurrency(movement.amount)}</td>
                    <td>{movement.createdByName || "ระบบ"} {movement.createdByPhone ? `· ${movement.createdByPhone}` : ""}</td>
                    <td>
                      {movement.relationLockReason ? (
                        <span title={movement.relationLockReason} className="inline-flex items-center gap-1 rounded-full bg-ink/10 px-2 py-1 text-xs font-bold text-ink/70">
                          <Lock size={12} />
                          ต้นทาง
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-leaf/10 px-2 py-1 text-xs font-bold text-leaf">
                          <X size={12} className="rotate-45" />
                          รายการสต็อก
                        </span>
                      )}
                    </td>
                    <td className="text-right">
                      {movement.sourceType !== "stock_entry" ? (
                        <span className="text-xs font-semibold text-ink/40">-</span>
                      ) : movement.txType === "transfer_in" ? (
                        <span className="text-xs font-semibold text-ink/50">ลบจากฝั่งย้ายออก</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleDeleteStockMovement(movement)}
                          disabled={!online}
                          title={online ? undefined : "ลบรายการสต็อกได้เมื่อออนไลน์เท่านั้น"}
                          className="focus-ring inline-flex h-9 items-center gap-1 rounded-md bg-field px-3 text-xs font-bold text-ink disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-white"
                        >
                          <Trash2 size={14} />
                          ขอลบ
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {productOpen && (
        <ProductModal
          products={products}
          saleItems={saleItems}
          isSaleItemsLoading={saleItemsLoading}
          online={online}
          onClose={() => setProductOpen(false)}
          onSave={addProduct}
          onAddSaleItem={addSaleItem}
          onEnableSaleItem={enableSaleItem}
          onDisableSaleItem={disableSaleItem}
          onUpdateSaleItemStockProduct={updateSaleItemStockProduct}
          onDeleteProduct={deleteProduct}
        />
      )}

      {receiveOpen && (
        <ReceiveModal
          location={selectedLocation}
          products={products}
          online={online}
          onClose={() => setReceiveOpen(false)}
          onSave={(input) => receiveStock({ locationId: selectedLocation.id, ...input })}
        />
      )}

      {transferOpen && (
        <TransferModal
          location={selectedLocation}
          locations={locations}
          products={products}
          balances={balances}
          online={online}
          onClose={() => setTransferOpen(false)}
          onSave={(input) => transferStock({ fromLocationId: selectedLocation.id, ...input })}
        />
      )}
    </section>
  );
}
