import { ArrowRightLeft, Check, PackagePlus, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useAcidProducts } from "@/hooks/useAcidProducts";
import { useAcidStock, type StockMovementFilter } from "@/hooks/useAcidStock";
import { useIncomeSaleItems } from "@/hooks/useIncomeSaleItems";
import { useStockEntryApprovals } from "@/hooks/useStockEntryApprovals";
import { useStockProductApprovals } from "@/hooks/useStockProductApprovals";
import { useStockSyncRetry } from "@/hooks/useStockSyncRetry";
import { todayInputValue } from "@/lib/format";
import { canManageSystemFeatures } from "@/lib/permissions";
import type { AcidProduct, AcidStockMovement, IncomeSaleItem, Location, Profile, StockEntryApprovalRequest, StockProductApprovalRequest } from "@/types";
import { ModalShell } from "@/components/shared/ModalShell";
import { Field } from "@/components/shared/Field";
import { NumberField } from "@/components/shared/NumberField";
import { isNetworkCancellation } from "@/lib/network-abort";
import { formatBangkokDateTime } from "@/lib/bangkok-date";
import { AlertDialog } from "@/components/shared/AlertDialog";
import { TablePageSizeSelect } from "@/components/shared/TablePagination";
import { StockBalanceTable } from "@/components/acid-stock/StockBalanceTable";
import { StockMovementTable } from "@/components/acid-stock/StockMovementTable";

function showActionError(error: unknown, fallback: string) {
  if (!isNetworkCancellation(error)) {
    toast.error(error instanceof Error ? error.message : fallback);
  }
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
      showActionError(error, "รับเข้าสต็อกไม่สำเร็จ");
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
        <div className="modal-actions flex justify-end gap-2 border-t border-black/10 pt-4">
          <button type="button" onClick={onClose} className="focus-ring h-11 rounded-md bg-actionSecondary px-4 font-semibold text-white hover:bg-actionSecondary/90">
            ยกเลิก
          </button>
          <button disabled={!online} className="focus-ring h-11 rounded-md bg-commit px-4 font-semibold text-white hover:bg-commit/90 disabled:cursor-not-allowed disabled:bg-slate-300">
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
      showActionError(error, "ย้ายสต็อกไม่สำเร็จ");
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
        <div className="modal-actions flex justify-end gap-2 border-t border-black/10 pt-4">
          <button type="button" onClick={onClose} className="focus-ring h-11 rounded-md bg-actionSecondary px-4 font-semibold text-white hover:bg-actionSecondary/90">
            ยกเลิก
          </button>
          <button disabled={!online} className="focus-ring h-11 rounded-md bg-commit px-4 font-semibold text-white hover:bg-commit/90 disabled:cursor-not-allowed disabled:bg-slate-300">
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
  const [pendingDeleteProduct, setPendingDeleteProduct] = useState<AcidProduct | null>(null);

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
      showActionError(error, "อัปเดตสถานะขายไม่สำเร็จ");
    } finally {
      setChangingProductId(null);
    }
  }

  function handleDeleteProduct(product: AcidProduct) {
    if (!online) {
      toast.error("ลบสินค้าได้เมื่อออนไลน์เท่านั้น");
      return;
    }
    setPendingDeleteProduct(product);
  }

  async function confirmDeleteProduct() {
    if (!pendingDeleteProduct) return;
    try {
      setChangingProductId(pendingDeleteProduct.id);
      await onDeleteProduct({ productId: pendingDeleteProduct.id });
      toast.success("ส่งคำขอลบสินค้าแล้ว รอผู้จัดการระบบอนุมัติ");
      setPendingDeleteProduct(null);
    } catch (error) {
      showActionError(error, "ส่งคำขอลบสินค้าไม่สำเร็จ");
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
      showActionError(error, "เพิ่มสินค้าไม่สำเร็จ");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
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
        <div className="modal-actions flex justify-end gap-2 border-t border-black/10 pt-4">
          <button type="button" onClick={onClose} className="focus-ring h-11 rounded-md bg-actionSecondary px-4 font-semibold text-white hover:bg-actionSecondary/90">
            ยกเลิก
          </button>
          <button disabled={isSaving || !online} className="focus-ring h-11 rounded-md bg-commit px-4 font-semibold text-white hover:bg-commit/90 disabled:cursor-not-allowed disabled:bg-slate-300">
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
                              className="focus-ring h-9 rounded-md bg-amber px-3 text-xs font-bold text-white hover:bg-amber/90 disabled:opacity-50"
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
    <AlertDialog
      open={Boolean(pendingDeleteProduct)}
      title="ส่งคำขอลบสินค้า"
      description={`ส่งคำขอลบสินค้า “${pendingDeleteProduct?.name ?? ""}” หรือไม่? รายการจะถูกลบเมื่อผู้จัดการระบบอนุมัติ`}
      confirmLabel="ส่งคำขอลบ"
      cancelLabel="ยกเลิก"
      busy={Boolean(pendingDeleteProduct && changingProductId === pendingDeleteProduct.id)}
      confirmClassName="bg-clay text-white hover:bg-clay/90"
      onCancel={() => setPendingDeleteProduct(null)}
      onConfirm={() => void confirmDeleteProduct()}
    />
    </>
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
  const [movementSearch, setMovementSearch] = useState("");
  const [debouncedMovementSearch, setDebouncedMovementSearch] = useState("");
  const [movementType, setMovementType] = useState<StockMovementFilter>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [movementPage, setMovementPage] = useState(1);
  const [movementPageSize, setMovementPageSize] = useState(10);
  const [balanceSearch, setBalanceSearch] = useState("");
  const [balanceStatus, setBalanceStatus] = useState<"all" | "available" | "empty">("all");
  const [balancePage, setBalancePage] = useState(1);
  const [balancePageSize, setBalancePageSize] = useState(10);
  const {
    balances: balanceRows,
    movements,
    balancesLoading,
    movementsLoading,
    balancesError,
    movementsError,
    hasMore,
    isLoadingMore,
    loadMore,
    receiveStock,
    transferStock,
    deleteStockEntry,
  } = useAcidStock(selectedLocation.id, {
    online,
    search: debouncedMovementSearch,
    type: movementType,
    fromDate,
    toDate,
  });
  const { requests: productApprovalRequests, isLoading: productApprovalsLoading, decideRequest: decideProductRequest } = useStockProductApprovals({ includeRequests: true });
  const { requests: entryApprovalRequests, isLoading: entryApprovalsLoading, decideRequest: decideEntryRequest } = useStockEntryApprovals({ includeRequests: true });
  const { retryStockSync, isRetrying, refreshStockSync, isRefreshing } = useStockSyncRetry(selectedLocation.id, profile.id);
  const [refreshWarning, setRefreshWarning] = useState<{ locationId: string; ownerUserId: string; message: string } | null>(null);
  const currentRefreshWarning = refreshWarning?.locationId === selectedLocation.id && refreshWarning.ownerUserId === profile.id
    ? refreshWarning.message : null;
  const canManageSystem = canManageSystemFeatures(profile);
  const offlineActionTitle = online ? undefined : "ใช้ได้เมื่อออนไลน์ เพราะต้องตรวจยอดสต็อกล่าสุด";
  const [productOpen, setProductOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [pendingStockDelete, setPendingStockDelete] = useState<AcidStockMovement | null>(null);
  const [deletingStock, setDeletingStock] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedMovementSearch(movementSearch.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [movementSearch]);

  useEffect(() => {
    setMovementPage(1);
  }, [selectedLocation.id, debouncedMovementSearch, movementType, fromDate, toDate, movementPageSize]);

  useEffect(() => {
    setBalancePage(1);
  }, [selectedLocation.id, balanceSearch, balanceStatus, balancePageSize]);

  useEffect(() => {
    const lastPage = Math.max(Math.ceil(movements.length / movementPageSize), 1);
    setMovementPage((current) => Math.min(current, lastPage));
  }, [movementPageSize, movements.length]);

  const balances = useMemo(
    () => new Map(balanceRows.map((row) => [row.productId, row.balance])),
    [balanceRows],
  );
  const filteredBalances = useMemo(() => {
    const term = balanceSearch.trim().toLocaleLowerCase("th-TH");
    return balanceRows.filter((row) =>
      (!term || `${row.name} ${row.unit}`.toLocaleLowerCase("th-TH").includes(term))
      && (balanceStatus === "all" || (balanceStatus === "available" ? row.balance > 0 : row.balance <= 0)),
    );
  }, [balanceRows, balanceSearch, balanceStatus]);

  useEffect(() => {
    const lastPage = Math.max(Math.ceil(filteredBalances.length / balancePageSize), 1);
    setBalancePage((current) => Math.min(current, lastPage));
  }, [balancePageSize, filteredBalances.length]);

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
    if (isRetrying || isRefreshing) return;
    if (!online) {
      toast.error("ซิงก์รายการได้เมื่อออนไลน์เท่านั้น");
      return;
    }

    try {
      setRefreshWarning(null);
      const result = await retryStockSync();
      if (result.refreshError) setRefreshWarning({ locationId: selectedLocation.id, ownerUserId: profile.id, message: result.refreshError });
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
      showActionError(error, "ซิงก์รายการไม่สำเร็จ");
    }
  }

  async function handleRefreshStockSync() {
    if (!online || isRetrying || isRefreshing) return;
    try {
      await refreshStockSync();
      setRefreshWarning((current) => current?.locationId === selectedLocation.id && current.ownerUserId === profile.id ? null : current);
    } catch (error) {
      setRefreshWarning({ locationId: selectedLocation.id, ownerUserId: profile.id, message: error instanceof Error ? error.message : "โหลดข้อมูลหลังซิงก์ไม่สำเร็จ" });
    }
  }

  function handleDeleteStockMovement(movement: AcidStockMovement) {
    if (movement.reportLockNo) {
      toast.error(`ล็อกโดยรายงาน ${movement.reportLockNo} — ต้องลบรายงานล่าสุดตามลำดับก่อน`);
      return;
    }
    if (!online) {
      toast.error("ลบรายการสต็อกได้เมื่อออนไลน์เท่านั้น");
      return;
    }
    if (movement.sourceType !== "stock_entry" || movement.txType === "transfer_in") {
      toast.error("ลบได้เฉพาะรายการรับเข้า หรือฝั่งย้ายออก");
      return;
    }

    setPendingStockDelete(movement);
  }

  async function confirmDeleteStockMovement() {
    if (!pendingStockDelete || deletingStock) return;
    setDeletingStock(true);
    try {
      await deleteStockEntry({ stockEntryId: pendingStockDelete.sourceId });
      toast.success("ส่งคำขอลบรายการสต็อกแล้ว รอผู้จัดการระบบอนุมัติ");
      setPendingStockDelete(null);
    } catch (error) {
      showActionError(error, "ส่งคำขอลบรายการสต็อกไม่สำเร็จ");
    } finally {
      setDeletingStock(false);
    }
  }

  async function handleMovementPageChange(nextPage: number) {
    const safePage = Math.max(1, nextPage);
    if ((safePage - 1) * movementPageSize >= movements.length && hasMore) {
      const loaded = await loadMore();
      if (!loaded) return;
    }
    setMovementPage(safePage);
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
      showActionError(error, "ดำเนินการคำขอไม่สำเร็จ");
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col items-start gap-3 rounded-md border border-black/10 bg-white p-3 shadow-panel sm:p-4">
        <div>
          <h2 className="text-balance text-lg font-bold text-ink">สต็อกสินค้า · {selectedLocation.name}</h2>
          <p className="text-pretty text-sm text-ink/60">ยอดคงเหลือรวมรายการรับเข้า ย้าย บิลขาย และหักจากบิลยาง</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <button
            type="button"
            onClick={handleRetryStockSync}
            disabled={!online || isRetrying || isRefreshing}
            title={offlineActionTitle}
            className="focus-ring flex h-10 items-center justify-center gap-2 rounded-md bg-actionSecondary px-3 text-sm font-semibold text-white hover:bg-actionSecondary/90 disabled:cursor-not-allowed disabled:bg-slate-300"
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
              className="focus-ring flex h-10 items-center justify-center gap-2 rounded-md bg-stockAdd px-3 text-sm font-semibold text-white hover:bg-stockAdd/90 disabled:cursor-not-allowed disabled:bg-slate-300"
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
            className="focus-ring flex h-10 w-full items-center justify-center gap-2 rounded-md bg-leaf px-4 text-sm font-semibold text-white hover:bg-leaf/90 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto"
          >
            <PackagePlus size={18} />
            รับเข้า
          </button>
          <button
            type="button"
            onClick={() => setTransferOpen(true)}
            disabled={products.length === 0 || locations.length < 2 || !online}
            title={products.length === 0 || locations.length < 2 ? "ต้องมีสินค้าและสาขาปลายทางก่อน" : offlineActionTitle}
            className="focus-ring flex h-10 items-center justify-center gap-2 rounded-md bg-stockMove px-3 text-sm font-semibold text-white hover:bg-stockMove/90 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <ArrowRightLeft size={18} />
            ย้ายสต็อก
          </button>
        </div>
      </div>

      {currentRefreshWarning && (
        <div role="status" className="space-y-2 rounded-md bg-amber/20 px-4 py-3 text-sm font-semibold text-amber-900">
          <p className="text-pretty">{currentRefreshWarning} รายการที่ซิงก์สำเร็จแล้วไม่ต้องส่งซ้ำ</p>
          <button type="button" onClick={() => void handleRefreshStockSync()} disabled={!online || isRetrying || isRefreshing}
            className="focus-ring rounded-md bg-actionSecondary px-3 py-2 text-white disabled:opacity-50">
            {isRefreshing ? "กำลังโหลดข้อมูล" : "โหลดข้อมูลใหม่"}
          </button>
        </div>
      )}

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
                  <th className="py-2">จัดการ</th>
                  <th className="py-2">วันที่</th>
                  <th>ประเภท</th>
                  <th>สินค้า</th>
                  <th>ผู้ขอ</th>
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
                      <td className="py-3 pr-3">
                        {canManageSystem ? (
                          <div className="flex gap-1.5 whitespace-nowrap">
                            <button type="button" onClick={() => handleDecideApproval(approval, "approved")} disabled={!online}
                              className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md bg-success text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                              title={online ? "อนุมัติ" : "อนุมัติได้เมื่อออนไลน์"} aria-label={online ? "อนุมัติ" : "อนุมัติได้เมื่อออนไลน์"}>
                              <Check size={17} />
                            </button>
                            <button type="button" onClick={() => handleDecideApproval(approval, "rejected")} disabled={!online}
                              className="focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md bg-clay text-white hover:bg-clay/90 disabled:cursor-not-allowed disabled:bg-slate-300"
                              title={online ? "ปฏิเสธ" : "ปฏิเสธได้เมื่อออนไลน์"} aria-label={online ? "ปฏิเสธ" : "ปฏิเสธได้เมื่อออนไลน์"}>
                              <X size={17} />
                            </button>
                          </div>
                        ) : <span className="text-xs font-semibold text-ink/50">รอผู้จัดการระบบ</span>}
                      </td>
                      <td className="py-3">{formatBangkokDateTime(approval.createdAt)}</td>
                      <td>
                        <span className="rounded-full bg-ink/10 px-2 py-1 text-xs font-bold text-ink/70">
                          {approval.typeLabel}
                        </span>
                      </td>
                      <td className="font-semibold text-ink">{approval.detail}</td>
                      <td>{approval.requestedByName || "ระบบ"} {approval.requestedByPhone ? `• ${approval.requestedByPhone}` : ""}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div>
        <h3 className="text-balance text-lg font-bold text-ink">ยอดคงเหลือสินค้า</h3>
        <p className="mt-1 text-pretty text-sm text-ink/60">รวมข้อมูลจากรายการรับเข้า ย้าย บิลขาย และบิลยางทั้งหมดของสาขา</p>
      </div>
      <div className="grid gap-3 rounded-md border border-black/10 bg-white p-3 shadow-panel lg:grid-cols-[minmax(16rem,1fr)_auto_auto] lg:items-end">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink/70">ค้นหาสินค้า</span>
          <span className="relative block">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/45" />
            <input type="search" value={balanceSearch} onChange={(event) => setBalanceSearch(event.target.value)} disabled={!online}
              placeholder="ชื่อสินค้าหรือหน่วย"
              className="focus-ring h-10 w-full rounded-md border border-black/20 bg-white pl-9 pr-10 text-sm disabled:cursor-not-allowed disabled:bg-slate-100" />
            {balanceSearch && <button type="button" onClick={() => setBalanceSearch("")} disabled={!online} aria-label="ล้างคำค้นหาสินค้า"
              className="focus-ring absolute right-1 top-1 inline-flex size-8 items-center justify-center rounded-md text-ink/55 hover:bg-field"><X size={16} /></button>}
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink/70">กรองยอดคงเหลือ</span>
          <select value={balanceStatus} onChange={(event) => setBalanceStatus(event.target.value as typeof balanceStatus)} disabled={!online}
            className="focus-ring h-10 rounded-md border border-black/20 bg-white px-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:bg-slate-100">
            <option value="all">ทั้งหมด</option><option value="available">มีสินค้า</option><option value="empty">หมดสต็อก</option>
          </select>
        </label>
        <TablePageSizeSelect pageSize={balancePageSize} onPageSizeChange={setBalancePageSize} />
      </div>
      {balancesError && <p role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{balancesError}</p>}
      <StockBalanceTable rows={filteredBalances} loading={balancesLoading} page={balancePage} pageSize={balancePageSize} onPageChange={setBalancePage} />

      <div className="pt-2">
        <h3 className="text-balance text-lg font-bold text-ink">รายการเคลื่อนไหวสต็อก</h3>
        <p className="mt-1 text-pretty text-sm text-ink/60">ค้นหาและกรองรายการย้อนหลัง โดยโหลดข้อมูลครั้งละ 50 รายการ</p>
      </div>
      <div className="grid gap-3 rounded-md border border-black/10 bg-white p-3 shadow-panel lg:grid-cols-[minmax(16rem,1fr)_auto_auto_auto_auto] lg:items-end">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-ink/70">ค้นหารายการ</span>
          <span className="relative block">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/45" />
            <input type="search" value={movementSearch} onChange={(event) => setMovementSearch(event.target.value)} disabled={!online}
              placeholder="เลขบิล สินค้า หรือผู้บันทึก"
              className="focus-ring h-10 w-full rounded-md border border-black/20 bg-white pl-9 pr-10 text-sm disabled:cursor-not-allowed disabled:bg-slate-100" />
            {movementSearch && <button type="button" onClick={() => setMovementSearch("")} disabled={!online} aria-label="ล้างคำค้นหารายการ"
              className="focus-ring absolute right-1 top-1 inline-flex size-8 items-center justify-center rounded-md text-ink/55 hover:bg-field"><X size={16} /></button>}
          </span>
        </label>
        <label className="block"><span className="mb-1 block text-sm font-semibold text-ink/70">ประเภท</span>
          <select value={movementType} onChange={(event) => setMovementType(event.target.value as StockMovementFilter)} disabled={!online}
            className="focus-ring h-10 rounded-md border border-black/20 bg-white px-3 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:bg-slate-100">
            <option value="all">ทั้งหมด</option><option value="receive">รับเข้า</option><option value="transfer">ย้ายสต็อก</option><option value="sale">บิลขาย</option><option value="rubber_bill">บิลยาง</option>
          </select>
        </label>
        <label className="block"><span className="mb-1 block text-sm font-semibold text-ink/70">จากวันที่</span>
          <input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => { const value = event.target.value; setFromDate(value); if (toDate && value > toDate) setToDate(value); }} disabled={!online}
            className="focus-ring h-10 rounded-md border border-black/20 bg-white px-3 text-sm tabular-nums disabled:cursor-not-allowed disabled:bg-slate-100" />
        </label>
        <label className="block"><span className="mb-1 block text-sm font-semibold text-ink/70">ถึงวันที่</span>
          <input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => { const value = event.target.value; setToDate(value); if (fromDate && value < fromDate) setFromDate(value); }} disabled={!online}
            className="focus-ring h-10 rounded-md border border-black/20 bg-white px-3 text-sm tabular-nums disabled:cursor-not-allowed disabled:bg-slate-100" />
        </label>
        <TablePageSizeSelect pageSize={movementPageSize} onPageSizeChange={setMovementPageSize} />
      </div>
      {(movementSearch || movementType !== "all" || fromDate || toDate) && (
        <div><button type="button" onClick={() => { setMovementSearch(""); setMovementType("all"); setFromDate(""); setToDate(""); }} disabled={!online}
          className="focus-ring inline-flex h-10 items-center gap-1.5 rounded-md bg-actionSecondary px-3 text-sm font-semibold text-white"><X size={16} /> ล้างตัวกรอง</button></div>
      )}
      {movementsError && <p role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{movementsError}</p>}
      <StockMovementTable rows={movements} loading={movementsLoading} online={online}
        page={movementPage} pageSize={movementPageSize} hasMore={hasMore} isLoadingMore={isLoadingMore}
        onPageChange={(nextPage) => void handleMovementPageChange(nextPage)} onDelete={handleDeleteStockMovement} />

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
      <AlertDialog
        open={Boolean(pendingStockDelete)}
        title="ส่งคำขอลบรายการสต็อก"
        description={pendingStockDelete?.txType === "transfer_out"
          ? `ส่งคำขอลบรายการย้ายสต็อก ${pendingStockDelete.displayBillNo} หรือไม่? ระบบจะลบทั้งฝั่งย้ายออกและย้ายเข้าเมื่ออนุมัติ`
          : `ส่งคำขอลบรายการรับเข้า ${pendingStockDelete?.displayBillNo ?? ""} หรือไม่?`}
        confirmLabel="ส่งคำขอลบ"
        cancelLabel="ยกเลิก"
        busy={deletingStock}
        confirmClassName="bg-clay text-white hover:bg-clay/90"
        onCancel={() => setPendingStockDelete(null)}
        onConfirm={() => void confirmDeleteStockMovement()}
      />
    </section>
  );
}
