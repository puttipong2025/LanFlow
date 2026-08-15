import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { TransportStaff } from "@/types";

function mapStaff(row: any): TransportStaff {
  return {
    id: row.id,
    clientTempId: row.client_temp_id,
    legacyRecId: row.legacy_rec_id,
    legacyMemberId: row.legacy_member_id,
    mainName: row.main_name,
    defaultLocationId: row.default_location_id,
    createdByUserId: row.created_by_user_id,
    createdByName: row.created_by_name,
    createdByPhone: row.created_by_phone,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncStatus: "synced",
    idempotencyKey: row.idempotency_key,
    revisionNo: row.revision_no,
    recordStatus: row.record_status,
    contacts: (row.transport_staff_contacts || []).map((c: any) => ({
      id: c.id,
      phone: c.phone,
    })),
    bankAccounts: (row.transport_staff_bank_accounts || []).map((b: any) => ({
      id: b.id,
      bankName: b.bank_name,
      accountNumber: b.account_number,
      accountName: b.account_name,
      isPrimary: b.is_primary,
    })),
    plates: (row.transport_staff_plates || []).map((p: any) => ({
      id: p.id,
      plateNumber: p.plate_number,
    })),
  };
}

export function useTransportStaffs() {
  const supabase = createSupabaseBrowserClient();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["transportStaffs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transport_staffs")
        .select(`
          *,
          transport_staff_contacts(id, phone),
          transport_staff_bank_accounts(id, bank_name, account_number, account_name, is_primary),
          transport_staff_plates(id, plate_number)
        `)
        .neq("record_status", "deleted")
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message || JSON.stringify(error));
      return (data || []).map(mapStaff);
    },
  });

  const addStaff = useMutation({
    mutationFn: async (staff: TransportStaff) => {
      const { data, error } = await supabase.rpc("save_transport_staff_master_data", {
        payload: staffWritePayload(staff),
      });

      if (error) throw new Error(error.message || JSON.stringify(error));
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transportStaffs"] });
    },
  });

  const updateStaff = useMutation({
    mutationFn: async (staff: TransportStaff) => {
      const { data, error } = await supabase.rpc("save_transport_staff_master_data", {
        payload: staffWritePayload(staff, staff.id),
      });

      if (error) throw new Error(error.message || JSON.stringify(error));
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transportStaffs"] });
    },
  });

  const deleteStaff = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("transport_staffs")
        .update({ record_status: "deleted" })
        .eq("id", id);
      if (error) throw new Error(error.message || JSON.stringify(error));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transportStaffs"] });
    },
  });

  return {
    staffs: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    addStaff,
    updateStaff,
    deleteStaff,
  };
}

function staffWritePayload(staff: TransportStaff, staffId?: string) {
  return {
    staffId,
    clientTempId: staff.clientTempId,
    legacyRecId: staff.legacyRecId,
    legacyMemberId: staff.legacyMemberId,
    mainName: staff.mainName,
    defaultLocationId: staff.defaultLocationId,
    idempotencyKey: staff.idempotencyKey,
    contacts: (staff.contacts ?? []).map(({ phone }) => ({ phone })),
    bankAccounts: (staff.bankAccounts ?? []).map((account) => ({
      bankName: account.bankName,
      accountNumber: account.accountNumber,
      accountName: account.accountName,
      isPrimary: account.isPrimary,
    })),
    plates: (staff.plates ?? []).map(({ plateNumber }) => ({ plateNumber })),
  };
}
