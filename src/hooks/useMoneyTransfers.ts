import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { MoneyTransfer, MoneyTransferSlip, MoneyTransferItem } from "@/types";
import { INCOME_EXPENSE_FEED_QUERY_KEY } from "@/lib/income-expense/query-keys";

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
          *,
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

      await supabase.from("money_transfer_items").delete().eq("transfer_id", transfer.id);
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
