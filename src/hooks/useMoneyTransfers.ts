import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { MoneyTransfer, MoneyTransferSlip, MoneyTransferItem } from "@/types";
import { INCOME_EXPENSE_FEED_QUERY_KEY } from "@/lib/income-expense/query-keys";

type MoneyTransferClient = ReturnType<typeof createSupabaseBrowserClient>;

type StoredTransferItem = {
  id: string;
  source_type: MoneyTransferItem["sourceType"];
  source_id: string;
  customer_name: string | null;
  amount: number | string;
};

function toTransferItemRow(transferId: string, item: MoneyTransferItem) {
  return {
    id: item.id,
    transfer_id: transferId,
    source_type: item.sourceType,
    source_id: item.sourceId,
    customer_name: item.customerName,
    amount: item.amount,
  };
}

function transferItemChanged(stored: StoredTransferItem, desired: MoneyTransferItem) {
  return (
    stored.customer_name !== desired.customerName
    || Number(stored.amount) !== desired.amount
  );
}

async function syncTransferItems(
  supabase: MoneyTransferClient,
  transferId: string,
  desiredItems: MoneyTransferItem[],
) {
  const { data: storedItems, error: fetchError } = await supabase
    .from("money_transfer_items")
    .select("id, source_type, source_id, customer_name, amount")
    .eq("transfer_id", transferId);

  if (fetchError) throw new Error("Items Fetch Error: " + fetchError.message);

  const desiredById = new Map(desiredItems.map((item) => [item.id, item]));
  const storedById = new Map(
    ((storedItems ?? []) as StoredTransferItem[]).map((item) => [item.id, item]),
  );

  // A source identity change must delete the old relation first so report-lock
  // triggers still validate the source that is being detached.
  const idsToDelete = [...storedById.values()]
    .filter((stored) => {
      const desired = desiredById.get(stored.id);
      return (
        !desired
        || desired.sourceType !== stored.source_type
        || desired.sourceId !== stored.source_id
      );
    })
    .map((stored) => stored.id);

  if (idsToDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from("money_transfer_items")
      .delete()
      .eq("transfer_id", transferId)
      .in("id", idsToDelete);

    if (deleteError) throw new Error("Items Delete Error: " + deleteError.message);
  }

  const rowsToWrite = desiredItems
    .filter((desired) => {
      const stored = storedById.get(desired.id);
      return (
        !stored
        || desired.sourceType !== stored.source_type
        || desired.sourceId !== stored.source_id
        || transferItemChanged(stored, desired)
      );
    })
    .map((item) => toTransferItemRow(transferId, item));

  if (rowsToWrite.length > 0) {
    const { error: writeError } = await supabase
      .from("money_transfer_items")
      .upsert(rowsToWrite);

    if (writeError) throw new Error("Items Sync Error: " + writeError.message);
  }
}

export function useMoneyTransfers(locationId: string, options: { enabled?: boolean } = {}) {
  const supabase = createSupabaseBrowserClient();
  const queryClient = useQueryClient();
  const enabled = options.enabled ?? true;

  const query = useQuery({
    queryKey: ["moneyTransfers", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("money_transfers")
        .select(`
          *, report_lock_no,
          money_transfer_slips(*),
          money_transfer_items(*)
        `)
        .eq("location_id", locationId)
        .neq("record_status", "deleted")
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message || JSON.stringify(error));
      
      return (data || []).map((row: any): MoneyTransfer => ({
        id: row.id,
        clientTempId: row.client_temp_id ?? row.id,
        idempotencyKey: row.idempotency_key ?? `server:${row.id}`,
        locationId: row.location_id,
        customerId: row.customer_id,
        customerName: row.customer_name,
        accountNumber: row.account_number,
        accountName: row.account_name,
        bankName: row.bank_name,
        netAmountToPay: Number(row.net_amount_to_pay ?? 0),
        branchPaidAmount: row.branch_paid_amount != null ? Number(row.branch_paid_amount) : undefined,
        transferType: row.transfer_type ?? 'customer',
        transportCost: row.transport_cost != null ? Number(row.transport_cost) : undefined,
        transportStaffId: row.transport_staff_id,
        transportStaffName: row.transport_staff_name,
        targetLocationId: row.target_location_id,
        targetLocationName: row.target_location_name,
        transferStatus: row.transfer_status,
        syncStatus: row.sync_status ?? "synced",
        recordStatus: row.record_status ?? "active",
        revisionNo: row.revision_no ?? 0,
        createdByUserId: row.created_by_user_id,
        createdByName: row.created_by_name,
        createdByPhone: row.created_by_phone,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        reportLockNo: row.report_lock_no ?? null,
        slips: (row.money_transfer_slips || []).map((s: any): MoneyTransferSlip => ({
          id: s.id,
          amount: Number(s.amount ?? 0),
          referenceNumber: s.reference_number,
          fee: Number(s.fee ?? 0),
          senderName: s.sender_name,
          receiverName: s.receiver_name,
          transactionDate: s.transaction_date,
          slipImageUrl: s.slip_image_url,
          sortOrder: s.sort_order ?? 0
        })),
        items: (row.money_transfer_items || []).map((i: any): MoneyTransferItem => ({
          id: i.id,
          sourceType: i.source_type,
          sourceId: i.source_id,
          customerName: i.customer_name,
          amount: Number(i.amount ?? 0)
        }))
      }));
    },
    enabled: !!locationId && enabled,
  });

  const addTransfer = useMutation({
    mutationFn: async (transfer: MoneyTransfer) => {
      const { data, error } = await supabase.from("money_transfers").insert({
        id: transfer.id,
        client_temp_id: transfer.clientTempId,
        idempotency_key: transfer.idempotencyKey,
        location_id: transfer.locationId,
        customer_id: transfer.customerId,
        customer_name: transfer.customerName,
        account_number: transfer.accountNumber,
        account_name: transfer.accountName,
        bank_name: transfer.bankName,
        net_amount_to_pay: transfer.netAmountToPay,
        branch_paid_amount: transfer.branchPaidAmount ?? 0,
        transfer_type: transfer.transferType,
        transport_cost: transfer.transportCost,
        transport_staff_id: transfer.transportStaffId,
        transport_staff_name: transfer.transportStaffName,
        target_location_id: transfer.targetLocationId,
        target_location_name: transfer.targetLocationName,
        transfer_status: transfer.transferStatus,
        created_by_user_id: transfer.createdByUserId,
        created_by_name: transfer.createdByName,
        created_by_phone: transfer.createdByPhone,
        revision_no: transfer.revisionNo,
        record_status: transfer.recordStatus
      }).select().single();

      if (error) throw new Error(error.message || JSON.stringify(error));

      if (transfer.slips && transfer.slips.length > 0) {
        const { error: slipsError } = await supabase.from("money_transfer_slips").insert(
          transfer.slips.map(s => ({
            id: s.id,
            transfer_id: transfer.id,
            amount: s.amount,
            reference_number: s.referenceNumber,
            fee: s.fee,
            sender_name: s.senderName,
            receiver_name: s.receiverName,
            transaction_date: s.transactionDate,
            slip_image_url: s.slipImageUrl,
            sort_order: s.sortOrder
          }))
        );
        if (slipsError) throw new Error("Slips Insert Error: " + slipsError.message);
      }

      if (transfer.items && transfer.items.length > 0) {
        const { error: itemsError } = await supabase.from("money_transfer_items").insert(
          transfer.items.map(i => ({
            id: i.id,
            transfer_id: transfer.id,
            source_type: i.sourceType,
            source_id: i.sourceId,
            customer_name: i.customerName,
            amount: i.amount
          }))
        );
        if (itemsError) throw new Error("Items Insert Error: " + itemsError.message);
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["moneyTransfers"] });
      queryClient.invalidateQueries({ queryKey: [INCOME_EXPENSE_FEED_QUERY_KEY] });
    }
  });

  const updateTransfer = useMutation({
    mutationFn: async (transfer: MoneyTransfer) => {
      const { data, error } = await supabase.from("money_transfers").update({
        location_id: transfer.locationId,
        customer_id: transfer.customerId,
        customer_name: transfer.customerName,
        account_number: transfer.accountNumber,
        account_name: transfer.accountName,
        bank_name: transfer.bankName,
        net_amount_to_pay: transfer.netAmountToPay,
        branch_paid_amount: transfer.branchPaidAmount ?? 0,
        transfer_type: transfer.transferType,
        transport_cost: transfer.transportCost,
        transport_staff_id: transfer.transportStaffId,
        transport_staff_name: transfer.transportStaffName,
        target_location_id: transfer.targetLocationId,
        target_location_name: transfer.targetLocationName,
        transfer_status: transfer.transferStatus,
        revision_no: transfer.revisionNo,
      }).eq("id", transfer.id).select().single();

      if (error) throw new Error(error.message || JSON.stringify(error));

      // naive relation sync:
      await supabase.from("money_transfer_slips").delete().eq("transfer_id", transfer.id);
      if (transfer.slips && transfer.slips.length > 0) {
        const { error: slipsError } = await supabase.from("money_transfer_slips").insert(
          transfer.slips.map(s => ({
            id: s.id,
            transfer_id: transfer.id,
            amount: s.amount,
            reference_number: s.referenceNumber,
            fee: s.fee,
            sender_name: s.senderName,
            receiver_name: s.receiverName,
            transaction_date: s.transactionDate,
            slip_image_url: s.slipImageUrl,
            sort_order: s.sortOrder
          }))
        );
        if (slipsError) throw new Error("Slips Insert Error: " + slipsError.message);
      }

      await syncTransferItems(supabase, transfer.id, transfer.items ?? []);

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["moneyTransfers"] });
      queryClient.invalidateQueries({ queryKey: [INCOME_EXPENSE_FEED_QUERY_KEY] });
    }
  });

  const deleteTransfer = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("money_transfers").update({ record_status: "deleted" }).eq("id", id);
      if (error) throw new Error(error.message || JSON.stringify(error));
      
      // Also release all tied items so they can be re-used
      await supabase.from("money_transfer_items").delete().eq("transfer_id", id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["moneyTransfers"] });
      queryClient.invalidateQueries({ queryKey: [INCOME_EXPENSE_FEED_QUERY_KEY] });
    }
  });

  return {
    transfers: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    addTransfer,
    updateTransfer,
    deleteTransfer
  };
}
