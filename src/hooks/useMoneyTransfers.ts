import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { MoneyTransfer, MoneyTransferSlip, MoneyTransferItem } from "@/types";

export function useMoneyTransfers(locationId: string) {
  const supabase = createSupabaseBrowserClient();
  const queryClient = useQueryClient();

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

      if (error) throw error;
      
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
    enabled: !!locationId,
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
        transfer_status: transfer.transferStatus,
        created_by_user_id: transfer.createdByUserId,
        created_by_name: transfer.createdByName,
        created_by_phone: transfer.createdByPhone,
        revision_no: transfer.revisionNo,
        record_status: transfer.recordStatus
      }).select().single();

      if (error) throw error;

      if (transfer.slips && transfer.slips.length > 0) {
        await supabase.from("money_transfer_slips").insert(
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
      }

      if (transfer.items && transfer.items.length > 0) {
        await supabase.from("money_transfer_items").insert(
          transfer.items.map(i => ({
            id: i.id,
            transfer_id: transfer.id,
            source_type: i.sourceType,
            source_id: i.sourceId,
            customer_name: i.customerName,
            amount: i.amount
          }))
        );
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["moneyTransfers", locationId] });
    }
  });

  const updateTransfer = useMutation({
    mutationFn: async (transfer: MoneyTransfer) => {
      const { data, error } = await supabase.from("money_transfers").update({
        customer_id: transfer.customerId,
        customer_name: transfer.customerName,
        account_number: transfer.accountNumber,
        account_name: transfer.accountName,
        bank_name: transfer.bankName,
        net_amount_to_pay: transfer.netAmountToPay,
        transfer_status: transfer.transferStatus,
        revision_no: transfer.revisionNo,
      }).eq("id", transfer.id).select().single();

      if (error) throw error;

      // naive relation sync:
      await supabase.from("money_transfer_slips").delete().eq("transfer_id", transfer.id);
      if (transfer.slips && transfer.slips.length > 0) {
        await supabase.from("money_transfer_slips").insert(
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
      }

      await supabase.from("money_transfer_items").delete().eq("transfer_id", transfer.id);
      if (transfer.items && transfer.items.length > 0) {
        await supabase.from("money_transfer_items").insert(
          transfer.items.map(i => ({
            id: i.id,
            transfer_id: transfer.id,
            source_type: i.sourceType,
            source_id: i.sourceId,
            customer_name: i.customerName,
            amount: i.amount
          }))
        );
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["moneyTransfers", locationId] });
    }
  });

  const deleteTransfer = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("money_transfers").update({ record_status: "deleted" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["moneyTransfers", locationId] });
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
