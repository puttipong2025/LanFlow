import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { RubberBill } from "@/types";
import { enqueueSyncEvent, getPendingEvents, removeSyncEvent, SyncEvent } from "@/lib/idb-queue";
import { useEffect } from "react";
import { toast } from "sonner";
import { OFFLINE_SYNCED_ACTION_MESSAGE } from "@/lib/record-action-locks";
import { assertOfflineRubberBillPriceAllowed } from "@/lib/rubber-bills/approval";

export function assertRubberBillDeleteAllowed(pendingCreateCount: number, isOnline: boolean) {
  if (pendingCreateCount === 0 && !isOnline) {
    throw new Error(OFFLINE_SYNCED_ACTION_MESSAGE);
  }
}

function buildRpcPayload(bill: RubberBill, operation: "create" | "update" | "delete", deletedByName?: string, deletedByPhone?: string) {
  const items: any[] = [];
  
  (bill.weighItems || []).forEach((item, i) => {
    items.push({
      itemType: "weigh",
      title: item.label,
      description: item.label,
      inWeight: item.inWeight,
      outWeight: item.outWeight,
      netWeight: item.netWeight,
      unitPrice: item.price,
      totalAmount: Math.floor(item.netWeight * item.price),
      sequenceNo: i + 1
    });
  });

  (bill.acidItems || []).forEach((item, i) => {
    items.push({
      itemType: "stock_deduction",
      title: item.name,
      description: item.name,
      stockProductId: item.stockProductId,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      totalAmount: item.quantity * item.unitPrice,
      sequenceNo: (bill.weighItems?.length || 0) + i + 1
    });
  });

  const allDebts = bill.debtItems ?? (bill.debtItem ? [bill.debtItem] : []);
  allDebts.forEach((item, i) => {
    items.push({
      itemType: "debt",
      title: item.title,
      description: item.title,
      totalAmount: item.amount,
      sequenceNo: (bill.weighItems?.length || 0) + (bill.acidItems?.length || 0) + i + 1
    });
  });

  return {
    operation,
    expectedRevisionNo: bill.revisionNo,
    clientTempId: bill.clientTempId,
    idempotencyKey: `${operation}:${bill.clientTempId}:${bill.revisionNo}`,
    locationId: bill.locationId,
    recordStatus: operation === "delete" ? "deleted" : bill.recordStatus,
    localBillNo: bill.localBillNo,
    billDate: bill.billDate,
    customerId: bill.customerId ?? null,
    customerName: bill.customerName,
    customerType: bill.customerType || "สาขานี้จ่าย",
    billType: bill.billType,
    deductWeight: bill.deductWeight,
    weight: bill.weight,
    rubberValue: bill.netTotal + bill.deductionTotal,
    averagePrice: bill.price,
    deductionTotal: bill.deductionTotal || 0,
    netTotal: bill.netTotal,
    cashPayment: bill.cashPayment,
    transferPayment: bill.transferPayment,
    acidPackCount: bill.acidPackCount,
    clientRecordedAt: bill.clientRecordedAt || new Date().toISOString(),
    clientCreatedAt: bill.clientCreatedAt || new Date().toISOString(),
    deletedByName,
    deletedByPhone,
    items
  };
}

let isSyncing = false;

function queuePartition(ownerUserId: string, locationId: string) {
  return { entity: "rubber_bills" as const, ownerUserId, locationId };
}

async function syncPendingBills(queryClient: any, ownerUserId: string, locationId: string) {
  if (isSyncing) return;
  if (!ownerUserId || !locationId || !navigator.onLine) return;
  
  isSyncing = true;
  try {
    await normalizeRubberBillQueueBeforeSync(ownerUserId, locationId);
    const events = await getPendingEvents(queuePartition(ownerUserId, locationId));
    // Precompute: block ALL ids that have any failed/conflict event
    const blockedIds = new Set<string>(
      events
        .filter(e => e.status === "conflict" || e.status === "failed")
        .map(e => e.id)
    );

    for (const event of events) {
      if (!navigator.onLine) break;

      if (blockedIds.has(event.id)) continue;

      try {
        const response = await fetch("/api/lanflow/rubber-bills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event.payload)
        });

        const data = await response.json();
        
        if (response.ok) {
          if (data.status === "pending_approval") {
            toast.success("ส่งคำขออนุมัติบิลยางแล้ว");
          }
          // Success -> remove from queue
          await removeSyncEvent(event.queueId!);
        } else if (!response.ok) {
          // Use RPC-level status to distinguish conflict from failed
          const isConflict = data.status === "conflict";
          const eventStatus = isConflict ? "conflict" : "failed";
          
          console.warn(`Sync ${eventStatus} for`, event.id, data.errorMessage);
          event.status = eventStatus;
          event.errorMessage = data.errorMessage || (isConflict ? "ข้อมูลชนกัน" : "ซิงก์ไม่สำเร็จ");
          await import("@/lib/idb-queue").then(m => m.updateSyncEvent(event));
          blockedIds.add(event.id);
          
          // For server errors (500), stop syncing entirely to retry later
          if (response.status >= 500) break;
        }
      } catch (err) {
        console.error("Network error during sync", err);
        break; // Stop on network error
      }
    }
  } finally {
    isSyncing = false;
    queryClient.invalidateQueries({ queryKey: ["rubberBills", ownerUserId, locationId] });
    queryClient.invalidateQueries({ queryKey: ["rubberBillApprovalMarkers", locationId] });
    queryClient.invalidateQueries({ queryKey: ["rubberBillApprovalRequests"] });
  }
}

async function normalizeRubberBillQueueBeforeSync(ownerUserId: string, locationId: string) {
  const { getPendingEvents, removeSyncEvent, updateSyncEvent } = await import("@/lib/idb-queue");
  const { coalesceQueueGroup } = await import("@/lib/coalesceQueueGroup");
  const events = await getPendingEvents(queuePartition(ownerUserId, locationId));
  const grouped = new Map<string, typeof events>();
  for (const e of events) {
    if (!grouped.has(e.id)) grouped.set(e.id, []);
    grouped.get(e.id)!.push(e);
  }

  for (const [_id, group] of grouped.entries()) {
    if (group.length <= 1) continue;
    // Don't coalesce if any event is locked (failed/conflict) — user must resolve first
    if (group.some(e => e.status === "conflict" || e.status === "failed")) continue;

    const result = coalesceQueueGroup(group);

    if (result.action === "noop") {
      for (const e of group) await removeSyncEvent(e.queueId!);
    } else {
      await updateSyncEvent(result.keeper);
      for (const e of result.remove) await removeSyncEvent(e.queueId!);
    }
  }
}

export function useRubberBills(
  locationId: string,
  ownerUserId: string,
  configuredPrice?: number | null
) {
  const supabase = createSupabaseBrowserClient();
  const queryClient = useQueryClient();

  // Trigger sync when coming online or on mount if already online
  useEffect(() => {
    const handleOnline = () => syncPendingBills(queryClient, ownerUserId, locationId);
    window.addEventListener("online", handleOnline);

    // Auto sync on mount if already online (e.g. app reopened while connected)
    if (navigator.onLine) {
      syncPendingBills(queryClient, ownerUserId, locationId);
    }

    return () => window.removeEventListener("online", handleOnline);
  }, [queryClient, ownerUserId, locationId]);

  const query = useQuery({
    queryKey: ["rubberBills", ownerUserId, locationId],
    networkMode: "always",
    queryFn: async () => {
      // 1. Fetch Server State (gracefully degrade when offline)
      let serverBills: RubberBill[] = [];

      try {
        const { data: bills, error: billsError } = await supabase
          .from("rubber_bills")
          .select("*, report_lock_no")
          .eq("location_id", locationId)
          .eq("record_status", "active")
          .order("created_at", { ascending: false });

        if (billsError) throw new Error(billsError.message || JSON.stringify(billsError));

        if (bills?.length) {
          const { data: items, error: itemsError } = await supabase
            .from("rubber_bill_items")
            .select("*")
            .in("bill_id", bills.map(b => b.id));

          if (itemsError) throw new Error(itemsError.message || JSON.stringify(itemsError));

          serverBills = bills.map((row: any): RubberBill => {
            const billItems = (items || []).filter((item: any) => item.bill_id === row.id);
            
            const weighItems = billItems
              .filter((item: any) => item.item_type === "weigh")
              .map((item: any) => ({
                id: item.id,
                label: item.description ?? "ชั่ง",
                inWeight: Number(item.weight_in ?? 0),
                outWeight: Number(item.weight_out ?? 0),
                netWeight: Number(item.net_weight ?? 0),
                price: Number(item.price ?? 0)
              }));
            const acidItems = billItems
              .filter((item: any) => item.item_type === "acid" || item.item_type === "stock_deduction")
              .map((item: any) => ({
                id: item.id,
                name: item.description ?? "สินค้า",
                stockProductId: item.stock_product_id ?? "",
                quantity: Number(item.quantity ?? 0),
                unit: item.unit ?? "ชิ้น",
                unitPrice: Number(item.price ?? 0)
              }));
            const debtItems = billItems
              .filter((item: any) => item.item_type === "debt")
              .map((item: any) => ({
                id: item.id,
                title: item.description ?? "หักชำระหนี้",
                amount: Number(item.total ?? 0)
              }));

            return {
              id: row.id,
              clientTempId: row.client_temp_id ?? row.id,
              localBillNo: row.local_bill_no,
              serverBillNo: row.server_bill_no ?? undefined,
              syncStatus: "synced",
              idempotencyKey: row.idempotency_key ?? `server:${row.id}`,
              locationId: row.location_id,
              billNo: row.bill_no,
              billDate: row.bill_date,
              customerId: row.customer_id ?? null,
              customerName: row.customer_name ?? "",
              customerType: row.customer_type,
              billType: row.bill_type === "weighing" ? "บิลเครื่องชั่งเล็ก" : row.bill_type,
              deductWeight: Number(row.deduct_weight ?? 0),
              weight: Number(row.weight ?? 0),
              price: Number(row.average_price ?? 0),
              deductionTotal: Number(row.deduction_total ?? 0),
              netTotal: Number(row.net_total ?? 0),
              cashPayment: Number(row.cash_payment ?? 0),
              transferPayment: Number(row.transfer_payment ?? 0),
              acidPackCount: Number(row.acid_pack_count ?? 0),
              printStatus: row.print_status === "ปริ้นแล้ว" ? "ปริ้นแล้ว" : "ยังไม่ได้ปริ้น",
              weighItems,
              acidItems,
              debtItem: debtItems[0],
              debtItems,
              createdByUserId: row.created_by_user_id,
              createdByName: row.created_by_name,
              createdByPhone: row.created_by_phone,
              clientCreatedAt: row.client_created_at ?? row.created_at,
              serverCreatedAt: row.created_at,
              clientRecordedAt: row.client_recorded_at ?? row.created_at,
              serverReceivedAt: row.server_received_at ?? undefined,
              revisionNo: row.revision_no ?? 0,
              recordStatus: row.record_status,
              deletedAt: row.deleted_at ?? undefined,
              deletedByName: row.deleted_by_name ?? undefined,
              deletedByPhone: row.deleted_by_phone ?? undefined,
              reportLockNo: row.report_lock_no ?? null
            };
          });
        }
      } catch (err) {
        // Offline or network error → use empty server state, merge queue below
        if (!navigator.onLine) {
          serverBills = [];
        } else {
          throw err; // re-throw real errors when online
        }
      }

      // 2. Fetch Pending Queue
      const pendingEvents = await getPendingEvents(queuePartition(ownerUserId, locationId));
      
      // 3. Merge server state and pending state
      const billsMap = new Map<string, RubberBill>();
      serverBills.forEach(b => billsMap.set(b.clientTempId, b));

      for (const event of pendingEvents) {
        if (event.operation === "delete") {
          if (event.status === "pending") {
            // Optimistic: hide the bill while delete is pending
            billsMap.delete(event.id);
          } else {
            // Conflict or failed: show the bill back with error status
            const existing = billsMap.get(event.id);
            if (existing) {
              billsMap.set(event.id, { ...existing, syncStatus: event.status === "conflict" ? "conflict" : "failed", syncErrorMessage: event.errorMessage });
            }
          }
          continue;
        } else {
          // It's create or update, overlay it
          const rawPayload = event.payload;
          
          // Convert RPC payload back to RubberBill shape for Optimistic UI
          const optimisticBill: RubberBill = {
            id: rawPayload.clientTempId,
            clientTempId: rawPayload.clientTempId,
            localBillNo: rawPayload.localBillNo,
            serverBillNo: undefined, // pending
            syncStatus: event.status === "conflict" ? "conflict" : event.status === "failed" ? "failed" : "pending",
            idempotencyKey: rawPayload.idempotencyKey,
            locationId: rawPayload.locationId,
            billNo: rawPayload.localBillNo,
            billDate: rawPayload.billDate,
            customerId: rawPayload.customerId ?? null,
            customerName: rawPayload.customerName,
            customerType: rawPayload.customerType,
            billType: rawPayload.billType ?? "บิลเครื่องชั่งเล็ก",
            deductWeight: rawPayload.deductWeight || 0,
            weight: rawPayload.weight || 0,
            price: rawPayload.averagePrice || 0,
            deductionTotal: rawPayload.deductionTotal || 0,
            netTotal: rawPayload.netTotal || 0,
            cashPayment: rawPayload.cashPayment || 0,
            transferPayment: rawPayload.transferPayment || 0,
            acidPackCount: rawPayload.acidPackCount || 0,
            printStatus: "ยังไม่ได้ปริ้น",
            weighItems: rawPayload.items.filter((i:any) => i.itemType === "weigh").map((i:any) => ({ id: i.sequenceNo.toString(), label: i.title, inWeight: i.inWeight, outWeight: i.outWeight, netWeight: i.netWeight, price: i.unitPrice })),
            acidItems: rawPayload.items.filter((i:any) => i.itemType === "acid" || i.itemType === "stock_deduction").map((i:any) => ({ id: i.sequenceNo.toString(), name: i.title, stockProductId: i.stockProductId, quantity: i.quantity, unit: i.unit, unitPrice: i.unitPrice })),
            debtItems: rawPayload.items.filter((i:any) => i.itemType === "debt").map((i:any) => ({ id: i.sequenceNo.toString(), title: i.title, amount: i.totalAmount })),
            debtItem: rawPayload.items.filter((i:any) => i.itemType === "debt")[0] ? { id: "1", title: rawPayload.items.filter((i:any) => i.itemType === "debt")[0].title, amount: rawPayload.items.filter((i:any) => i.itemType === "debt")[0].totalAmount } : undefined,
            createdByUserId: "",
            createdByName: "",
            createdByPhone: "",
            clientCreatedAt: rawPayload.clientCreatedAt,
            serverCreatedAt: rawPayload.clientCreatedAt,
            clientRecordedAt: rawPayload.clientRecordedAt,
            revisionNo: rawPayload.expectedRevisionNo + 1,
            recordStatus: "active",
            syncErrorMessage: event.errorMessage
          };
          billsMap.set(event.id, optimisticBill);
        }
      }

      return Array.from(billsMap.values()).sort((a, b) => 
        new Date(b.clientRecordedAt).getTime() - new Date(a.clientRecordedAt).getTime()
      );
    },
    enabled: !!locationId && !!ownerUserId,
  });

  const saveBillMutation = useMutation({
    networkMode: "always",
    mutationFn: async (bill: RubberBill) => {
      const isUpdate = Boolean(bill.serverBillNo) || bill.id !== bill.clientTempId;
      const operation = isUpdate ? "update" : "create";
      if ((bill.acidItems?.length ?? 0) > 0 && typeof navigator !== "undefined" && !navigator.onLine) {
        throw new Error("รายการหักสินค้าตัดสต็อก ต้องออนไลน์ก่อนบันทึก");
      }
      if (operation === "update" && typeof navigator !== "undefined" && !navigator.onLine) {
        throw new Error(OFFLINE_SYNCED_ACTION_MESSAGE);
      }
      if (operation === "create" && typeof navigator !== "undefined") {
        assertOfflineRubberBillPriceAllowed(
          (bill.weighItems ?? []).map((item) => item.price),
          configuredPrice,
          navigator.onLine
        );
      }
      
      const payload = buildRpcPayload(bill, operation);

      const existingEvents = await getPendingEvents(queuePartition(ownerUserId, locationId));
      const clientEvents = existingEvents.filter(e => e.id === bill.clientTempId);

      if (clientEvents.some(e => e.status === "conflict" || e.status === "failed")) {
        throw new Error("ไม่สามารถบันทึกได้ กรุณาแก้ไขข้อมูลที่ขัดแย้ง หรือลองซิงก์ใหม่อีกครั้ง");
      }
      if (clientEvents.some(e => e.operation === "delete")) {
        throw new Error("ไม่สามารถบันทึกได้ บิลนี้กำลังถูกลบ");
      }

      const pendingCreates = clientEvents.filter(e => e.operation === "create");
      const pendingUpdates = clientEvents.filter(e => e.operation === "update");

      const mLib = await import("@/lib/idb-queue");

      let keeper: typeof clientEvents[0] | undefined;
      let toDelete: typeof clientEvents = [];

      if (pendingCreates.length > 0) {
        keeper = pendingCreates[0]; // oldest create
        toDelete = [...pendingCreates.slice(1), ...pendingUpdates];
      } else if (pendingUpdates.length > 0) {
        keeper = pendingUpdates[0]; // oldest update
        toDelete = pendingUpdates.slice(1);
      }

      for (const e of toDelete) {
        if (e.queueId) await mLib.removeSyncEvent(e.queueId);
      }

      if (keeper) {
        if (keeper.operation === "create") {
          keeper.payload = { ...payload, operation: "create", expectedRevisionNo: 0 };
          keeper.timestamp = Date.now();
          await mLib.updateSyncEvent(keeper);
        } else {
          const originalRev = keeper.payload.expectedRevisionNo;
          keeper.payload = { 
            ...payload, 
            operation: "update", 
            expectedRevisionNo: originalRev,
            idempotencyKey: `update:${bill.clientTempId}:${originalRev}`
          };
          keeper.timestamp = Date.now();
          await mLib.updateSyncEvent(keeper);
        }
      } else {
        await enqueueSyncEvent({
          id: bill.clientTempId,
          entity: "rubber_bills",
          ownerUserId,
          locationId,
          operation,
          payload,
          timestamp: Date.now(),
          status: "pending"
        });
      }
      
      return bill;
    },
    onSuccess: (savedBill) => {
      queryClient.setQueryData<RubberBill[]>(["rubberBills", ownerUserId, locationId], (old) => {
        if (!old) return [savedBill];
        const exists = old.findIndex(b => b.clientTempId === savedBill.clientTempId);
        if (exists >= 0) {
          const newBills = [...old];
          newBills[exists] = { ...newBills[exists], ...savedBill, syncStatus: "pending" };
          return newBills;
        }
        return [{ ...savedBill, syncStatus: "pending" }, ...old];
      });
      queryClient.invalidateQueries({ queryKey: ["rubberBills", ownerUserId, locationId] });
      queryClient.invalidateQueries({ queryKey: ["incomeExpense", locationId] });
      queryClient.invalidateQueries({ queryKey: ["acidStock", locationId] });
      syncPendingBills(queryClient, ownerUserId, locationId);
    }
  });

  const deleteBillMutation = useMutation({
    networkMode: "always",
    mutationFn: async ({ id, clientTempId, deletedByName, deletedByPhone, revisionNo }: { id: string, clientTempId: string, deletedByName: string, deletedByPhone: string, revisionNo: number }) => {
      const existingEvents = await getPendingEvents(queuePartition(ownerUserId, locationId));
      const clientEvents = existingEvents.filter(e => e.id === clientTempId);

      if (clientEvents.some(e => e.status === "conflict" || e.status === "failed")) {
        throw new Error("ไม่สามารถลบได้ กรุณาแก้ไขข้อมูลที่ขัดแย้ง หรือลองซิงก์ใหม่อีกครั้ง");
      }
      if (clientEvents.some(e => e.operation === "delete")) {
        return { clientTempId, coalesced: false }; // Already deleting
      }

      const pendingCreates = clientEvents.filter(e => e.operation === "create");
      const pendingUpdates = clientEvents.filter(e => e.operation === "update");

      assertRubberBillDeleteAllowed(
        pendingCreates.length,
        typeof navigator === "undefined" || navigator.onLine
      );

      const mLib = await import("@/lib/idb-queue");

      // Cleanup all pending updates (they will be replaced by this delete)
      for (const e of pendingUpdates) {
        if (e.queueId) await mLib.removeSyncEvent(e.queueId);
      }

      if (pendingCreates.length > 0) {
        // Coalesce: remove all creates, and don't sync delete to server
        for (const e of pendingCreates) {
          if (e.queueId) await mLib.removeSyncEvent(e.queueId);
        }
        return { clientTempId, coalesced: true };
      }

      const bills = queryClient.getQueryData<RubberBill[]>(["rubberBills", ownerUserId, locationId]);
      const bill = bills?.find(b => b.clientTempId === clientTempId);
      if (!bill) throw new Error("Bill not found in local cache");

      // If we replaced a pending update, use its server revision. Else use current bill's server revision.
      const targetRev = pendingUpdates.length > 0 ? pendingUpdates[0].payload.expectedRevisionNo : bill.revisionNo;
      const payload = {
        ...buildRpcPayload(bill, "delete", deletedByName, deletedByPhone),
        expectedRevisionNo: targetRev,
        idempotencyKey: `delete:${clientTempId}:${targetRev}`
      };
      
      await enqueueSyncEvent({
        id: clientTempId,
        entity: "rubber_bills",
        ownerUserId,
        locationId,
        operation: "delete",
        payload,
        timestamp: Date.now(),
        status: "pending"
      });
      return { clientTempId, coalesced: false };
    },
    onSuccess: (data) => {
      queryClient.setQueryData<RubberBill[]>(["rubberBills", ownerUserId, locationId], (old) => {
        if (!old) return old;
        return old.filter(b => b.clientTempId !== data.clientTempId);
      });
      queryClient.invalidateQueries({ queryKey: ["rubberBills", ownerUserId, locationId] });
      queryClient.invalidateQueries({ queryKey: ["incomeExpense", locationId] });
      queryClient.invalidateQueries({ queryKey: ["acidStock", locationId] });
      syncPendingBills(queryClient, ownerUserId, locationId);
    }
  });

  const markPrintedMutation = useMutation({
    mutationFn: async (billId: string) => {
      const response = await fetch(`/api/lanflow/rubber-bills/${encodeURIComponent(billId)}/print-status`, {
        method: "POST"
      });
      const result = await response.json().catch(() => ({})) as { status?: string; errorMessage?: string };
      if (!response.ok || result.status !== "synced") {
        throw new Error(result.errorMessage || "บันทึกสถานะการพิมพ์ไม่สำเร็จ");
      }
      return billId;
    },
    onSuccess: (billId) => {
      queryClient.setQueryData<RubberBill[]>(["rubberBills", ownerUserId, locationId], (current) =>
        current?.map((bill) => bill.id === billId ? { ...bill, printStatus: "ปริ้นแล้ว" } : bill)
      );
      queryClient.invalidateQueries({ queryKey: ["rubberBills", ownerUserId, locationId] });
    }
  });

  return {
    bills: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    addBill: saveBillMutation.mutateAsync,
    updateBill: saveBillMutation.mutateAsync,
    deleteBill: deleteBillMutation.mutateAsync,
    markPrinted: markPrintedMutation.mutateAsync,
    isMarkingPrinted: markPrintedMutation.isPending,
  };
}
