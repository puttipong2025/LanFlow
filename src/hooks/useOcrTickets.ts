import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { OcrTicket } from "@/types";

export function useOcrTickets(locationId: string) {
  const supabase = createSupabaseBrowserClient();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["ocrTickets", locationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocr_tickets")
        .select("*")
        .eq("location_id", locationId)
        .neq("record_status", "deleted")
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message || JSON.stringify(error));
      
      return (data || []).map((row: any): OcrTicket => ({
        id: row.id,
        clientTempId: row.client_temp_id ?? row.id,
        idempotencyKey: row.idempotency_key ?? `server:${row.id}`,
        locationId: row.location_id,
        fileName: row.file_name,
        ticketId: row.ticket_id ?? null,
        licensePlate: row.license_plate ?? null,
        dateIn: row.date_in ?? null,
        weightIn: row.weight_in != null ? Number(row.weight_in) : null,
        weightOut: row.weight_out != null ? Number(row.weight_out) : null,
        weightNet: row.weight_net != null ? Number(row.weight_net) : null,
        weightDeducted: row.weight_deducted != null ? Number(row.weight_deducted) : null,
        weightRemaining: row.weight_remaining != null ? Number(row.weight_remaining) : null,
        totalAmount: row.total_amount != null ? Number(row.total_amount) : null,
        driveFileId: row.drive_file_id ?? null,
        driveUrl: row.drive_url ?? null,
        customerName: row.customer_name ?? null,
        moneyDeducted: row.money_deducted != null ? Number(row.money_deducted) : null,
        syncStatus: row.sync_status ?? "synced",
        recordStatus: row.record_status ?? "active",
        revisionNo: row.revision_no ?? 0,
        createdByName: row.created_by_name ?? undefined,
        createdByPhone: row.created_by_phone ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    },
    enabled: !!locationId,
  });

  const addTicket = useMutation({
    mutationFn: async (ticket: OcrTicket) => {
      const { data, error } = await supabase.from("ocr_tickets").insert({
        id: ticket.id,
        client_temp_id: ticket.clientTempId,
        idempotency_key: ticket.idempotencyKey,
        location_id: ticket.locationId,
        file_name: ticket.fileName,
        ticket_id: ticket.ticketId,
        license_plate: ticket.licensePlate,
        date_in: ticket.dateIn,
        weight_in: ticket.weightIn,
        weight_out: ticket.weightOut,
        weight_net: ticket.weightNet,
        weight_deducted: ticket.weightDeducted,
        weight_remaining: ticket.weightRemaining,
        total_amount: ticket.totalAmount,
        drive_file_id: ticket.driveFileId,
        drive_url: ticket.driveUrl,
        customer_name: ticket.customerName,
        money_deducted: ticket.moneyDeducted,
        sync_status: ticket.syncStatus,
        record_status: ticket.recordStatus,
        revision_no: ticket.revisionNo,
        created_by_name: ticket.createdByName,
        created_by_phone: ticket.createdByPhone,
      }).select().single();

      if (error) throw new Error(error.message || JSON.stringify(error));
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ocrTickets", locationId] });
    }
  });

  const updateTicket = useMutation({
    mutationFn: async (ticket: OcrTicket) => {
      const { data, error } = await supabase.from("ocr_tickets").update({
        ticket_id: ticket.ticketId,
        license_plate: ticket.licensePlate,
        date_in: ticket.dateIn,
        weight_in: ticket.weightIn,
        weight_out: ticket.weightOut,
        weight_net: ticket.weightNet,
        weight_deducted: ticket.weightDeducted,
        weight_remaining: ticket.weightRemaining,
        total_amount: ticket.totalAmount,
        drive_file_id: ticket.driveFileId,
        drive_url: ticket.driveUrl,
        customer_name: ticket.customerName,
        money_deducted: ticket.moneyDeducted,
        sync_status: ticket.syncStatus,
        record_status: ticket.recordStatus,
        revision_no: ticket.revisionNo,
      }).eq("id", ticket.id).select().single();

      if (error) throw new Error(error.message || JSON.stringify(error));
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ocrTickets", locationId] });
    }
  });

  const deleteTicket = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("ocr_tickets").update({ record_status: "deleted" }).eq("id", id);
      if (error) throw new Error(error.message || JSON.stringify(error));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ocrTickets", locationId] });
    }
  });

  return {
    ocrTickets: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    addTicket,
    updateTicket,
    deleteTicket
  };
}
