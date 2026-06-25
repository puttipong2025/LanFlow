import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { IncomeExpense } from "@/types";

export function useIncomeExpense(locationId: string) {
  const supabase = createSupabaseBrowserClient();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["incomeExpense", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("income_expense")
        .select("*")
        .eq("location_id", locationId)
        .eq("record_status", "active")
        .order("tx_date", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) throw error;
      
      return data.map((row: any) => ({
        id: row.id,
        clientTempId: row.client_temp_id,
        localBillNo: row.local_bill_no,
        serverBillNo: row.server_bill_no,
        idempotencyKey: row.idempotency_key,
        locationId: row.location_id,
        syncStatus: row.sync_status,
        recordStatus: row.record_status,
        type: row.type,
        txDate: row.tx_date,
        title: row.title,
        cost: row.cost,
        unit: row.unit,
        price: row.price,
        billOption: row.bill_option,
        transactionOption: row.transaction_option,
        clientRecordedAt: row.client_recorded_at,
        clientCreatedAt: row.client_created_at,
        serverReceivedAt: row.server_received_at,
        revisionNo: row.revision_no,
        deletedAt: row.deleted_at,
        deletedByName: row.deleted_by_name,
        deletedByPhone: row.deleted_by_phone,
        createdByName: row.created_by_name,
        createdByPhone: row.created_by_phone
      })) as IncomeExpense[];
    },
    enabled: !!locationId,
  });

  const generateTxNo = async (date: string) => {
    const todayStr = date.replace(/-/g, "").slice(2); // YYMMDD
    const { data } = await supabase
      .from("income_expense")
      .select("server_bill_no")
      .eq("location_id", locationId)
      .eq("tx_date", date)
      .order("server_bill_no", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data?.server_bill_no) {
      const currentSeq = parseInt(data.server_bill_no.slice(-4), 10);
      const nextSeq = currentSeq + 1;
      return `${todayStr}${nextSeq.toString().padStart(4, "0")}`;
    }
    return `${todayStr}0001`;
  };

  const saveTxMutation = useMutation({
    mutationFn: async (transaction: IncomeExpense) => {
      const serverBillNo = transaction.serverBillNo || await generateTxNo(transaction.txDate);

      const row = {
        client_temp_id: transaction.clientTempId,
        local_bill_no: transaction.localBillNo,
        server_bill_no: serverBillNo,
        idempotency_key: transaction.idempotencyKey,
        sync_status: "synced",
        record_status: transaction.recordStatus,
        location_id: transaction.locationId,
        type: transaction.type,
        number: serverBillNo,
        tx_date: transaction.txDate,
        title: transaction.title,
        cost: transaction.cost,
        unit: transaction.unit,
        price: transaction.price,
        bill_option: transaction.billOption,
        transaction_option: transaction.transactionOption,
        client_recorded_at: transaction.clientRecordedAt,
        client_created_at: transaction.clientCreatedAt,
        revision_no: transaction.revisionNo,
        created_by_name: transaction.createdByName,
        created_by_phone: transaction.createdByPhone,
        updated_at: new Date().toISOString()
      };

      const existing = await supabase
        .from("income_expense")
        .select("id")
        .eq("client_temp_id", transaction.clientTempId)
        .maybeSingle();

      let txId = transaction.id;
      if (existing.data?.id) {
        txId = existing.data.id;
        const { error } = await supabase.from("income_expense").update(row).eq("id", txId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("income_expense").insert(row).select("id").single();
        if (error) throw error;
        txId = data.id;
      }

      return { ...transaction, id: txId, serverBillNo };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incomeExpense", locationId] });
    }
  });

  const deleteTxMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("income_expense").update({ record_status: "deleted" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incomeExpense", locationId] });
    }
  });

  return {
    transactions: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    addTransaction: saveTxMutation.mutateAsync,
    updateTransaction: saveTxMutation.mutateAsync,
    deleteTransaction: deleteTxMutation.mutateAsync,
  };
}
