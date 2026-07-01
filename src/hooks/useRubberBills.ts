import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { RubberBill } from "@/types";

export function useRubberBills(locationId: string) {
  const supabase = createSupabaseBrowserClient();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["rubberBills", locationId],
    queryFn: async () => {
      const { data: bills, error: billsError } = await supabase
        .from("rubber_bills")
        .select("*")
        .eq("location_id", locationId)
        .order("created_at", { ascending: false });

      if (billsError) throw new Error(billsError.message || JSON.stringify(billsError));

      const { data: items, error: itemsError } = await supabase
        .from("rubber_bill_items")
        .select("*")
        .in("bill_id", bills.map(b => b.id));

      if (itemsError) throw new Error(itemsError.message || JSON.stringify(itemsError));

      return (bills || []).map((row: any): RubberBill => {
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
          .filter((item: any) => item.item_type === "acid")
          .map((item: any) => ({
            id: item.id,
            name: item.description ?? "น้ำกรด",
            quantity: Number(item.quantity ?? 0),
            unit: item.unit ?? "แพ็ค",
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
          syncStatus: row.sync_status,
          idempotencyKey: row.idempotency_key ?? `server:${row.id}`,
          locationId: row.location_id,
          billNo: row.bill_no,
          billDate: row.bill_date,
          customerName: row.customer_name ?? "",
          customerType: row.customer_type,
          billType: row.bill_type,
          weight: Number(row.weight ?? 0),
          price: Number(row.average_price ?? 0),
          deductionTotal: Number(row.deduction_total ?? 0),
          netTotal: Number(row.net_total ?? 0),
          cashPayment: Number(row.cash_payment ?? 0),
          transferPayment: Number(row.transfer_payment ?? 0),
          acidPackCount: Number(row.acid_pack_count ?? 0),
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
          deletedByPhone: row.deleted_by_phone ?? undefined
        };
      });
    },
    enabled: !!locationId,
  });

  const generateBillNo = async (date: string) => {
    const todayStr = date.replace(/-/g, "").slice(2); // YYMMDD
    const { data } = await supabase
      .from("rubber_bills")
      .select("bill_no")
      .eq("location_id", locationId)
      .eq("bill_date", date)
      .order("bill_no", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data?.bill_no) {
      const currentSeq = parseInt(data.bill_no.slice(-4), 10);
      const nextSeq = currentSeq + 1;
      return `${todayStr}${nextSeq.toString().padStart(4, "0")}`;
    }
    return `${todayStr}0001`;
  };

  const saveBillMutation = useMutation({
    mutationFn: async (bill: RubberBill) => {
      // 1. Get or Generate Server Bill No
      const serverBillNo = bill.serverBillNo || await generateBillNo(bill.billDate);

      // 2. Insert or Update rubber_bills
      const row = {
        client_temp_id: bill.clientTempId,
        local_bill_no: bill.localBillNo,
        server_bill_no: serverBillNo,
        idempotency_key: bill.idempotencyKey,
        sync_status: "synced",
        record_status: bill.recordStatus,
        location_id: bill.locationId,
        bill_no: serverBillNo,
        bill_date: bill.billDate,
        customer_name: bill.customerName,
        customer_type: bill.customerType,
        bill_type: bill.billType,
        weight: bill.weight,
        rubber_value: bill.netTotal + bill.deductionTotal,
        average_price: bill.price,
        deduction_total: bill.deductionTotal,
        net_total: bill.netTotal,
        cash_payment: bill.cashPayment,
        transfer_payment: bill.transferPayment,
        acid_pack_count: bill.acidPackCount,
        client_recorded_at: bill.clientRecordedAt,
        client_created_at: bill.clientCreatedAt,
        revision_no: bill.revisionNo,
        created_by_user_id: bill.createdByUserId,
        created_by_name: bill.createdByName,
        created_by_phone: bill.createdByPhone,
        updated_at: new Date().toISOString()
      };

      const existing = await supabase
        .from("rubber_bills")
        .select("id")
        .eq("client_temp_id", bill.clientTempId)
        .maybeSingle();

      let billId = bill.id;
      if (existing.data?.id) {
        billId = existing.data.id;
        const { error } = await supabase.from("rubber_bills").update(row).eq("id", billId);
        if (error) throw new Error(error.message || JSON.stringify(error));
      } else {
        const { data, error } = await supabase.from("rubber_bills").insert(row).select("id").single();
        if (error) throw new Error(error.message || JSON.stringify(error));
        billId = data.id;
      }

      // 3. Delete old items
      await supabase.from("rubber_bill_items").delete().eq("bill_id", billId);

      // 4. Insert new items
      const items = [
        ...(bill.weighItems ?? []).map((item) => ({
          bill_id: billId,
          item_type: "weigh",
          description: item.label,
          weight_in: item.inWeight,
          weight_out: item.outWeight,
          net_weight: item.netWeight,
          price: item.price,
          total: Math.floor(item.netWeight * item.price)
        })),
        ...(bill.acidItems ?? []).map((item) => ({
          bill_id: billId,
          item_type: "acid",
          description: item.name,
          quantity: item.quantity,
          unit: item.unit,
          price: item.unitPrice,
          total: item.quantity * item.unitPrice
        })),
        ...((bill.debtItems ?? (bill.debtItem ? [bill.debtItem] : [])).map((item) => ({
          bill_id: billId,
          item_type: "debt",
          description: item.title,
          total: item.amount
        })))
      ];

      if (items.length > 0) {
        const { error } = await supabase.from("rubber_bill_items").insert(items);
        if (error) throw new Error(error.message || JSON.stringify(error));
      }

      return { ...bill, id: billId, serverBillNo };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rubberBills", locationId] });
    }
  });

  const deleteBillMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("rubber_bills").update({ record_status: "deleted" }).eq("id", id);
      if (error) throw new Error(error.message || JSON.stringify(error));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rubberBills", locationId] });
    }
  });

  return {
    bills: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    addBill: saveBillMutation.mutateAsync,
    updateBill: saveBillMutation.mutateAsync,
    deleteBill: deleteBillMutation.mutateAsync,
  };
}
