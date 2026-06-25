import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { TransportStaff, TransportStaffPlate, CustomerContact, CustomerBankAccount } from "@/types";

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

      if (error) throw error;
      return (data || []).map(mapStaff);
    },
  });

  const addStaff = useMutation({
    mutationFn: async (staff: TransportStaff) => {
      const { data, error } = await supabase.from("transport_staffs").insert({
        id: staff.id,
        client_temp_id: staff.clientTempId,
        legacy_rec_id: staff.legacyRecId,
        legacy_member_id: staff.legacyMemberId,
        main_name: staff.mainName,
        default_location_id: staff.defaultLocationId,
        created_by_user_id: staff.createdByUserId,
        created_by_name: staff.createdByName,
        created_by_phone: staff.createdByPhone,
        idempotency_key: staff.idempotencyKey,
        revision_no: staff.revisionNo,
        record_status: staff.recordStatus,
      }).select().single();

      if (error) throw error;

      if (staff.contacts && staff.contacts.length > 0) {
        await supabase.from("transport_staff_contacts").insert(
          staff.contacts.map((c) => ({
            id: c.id,
            staff_id: staff.id,
            phone: c.phone,
          }))
        );
      }
      if (staff.bankAccounts && staff.bankAccounts.length > 0) {
        await supabase.from("transport_staff_bank_accounts").insert(
          staff.bankAccounts.map((b) => ({
            id: b.id,
            staff_id: staff.id,
            bank_name: b.bankName,
            account_number: b.accountNumber,
            account_name: b.accountName,
            is_primary: b.isPrimary,
          }))
        );
      }
      if (staff.plates && staff.plates.length > 0) {
        await supabase.from("transport_staff_plates").insert(
          staff.plates.map((p) => ({
            id: p.id,
            staff_id: staff.id,
            plate_number: p.plateNumber,
          }))
        );
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transportStaffs"] });
    },
  });

  const updateStaff = useMutation({
    mutationFn: async (staff: TransportStaff) => {
      const { data, error } = await supabase
        .from("transport_staffs")
        .update({
          legacy_member_id: staff.legacyMemberId,
          main_name: staff.mainName,
          revision_no: staff.revisionNo,
        })
        .eq("id", staff.id)
        .select().single();

      if (error) throw error;

      // Simplistic relation update: delete all and insert new.
      // A more robust approach would diff and patch.
      await supabase.from("transport_staff_contacts").delete().eq("staff_id", staff.id);
      if (staff.contacts && staff.contacts.length > 0) {
        await supabase.from("transport_staff_contacts").insert(
          staff.contacts.map((c) => ({
            id: c.id,
            staff_id: staff.id,
            phone: c.phone,
          }))
        );
      }

      await supabase.from("transport_staff_bank_accounts").delete().eq("staff_id", staff.id);
      if (staff.bankAccounts && staff.bankAccounts.length > 0) {
        await supabase.from("transport_staff_bank_accounts").insert(
          staff.bankAccounts.map((b) => ({
            id: b.id,
            staff_id: staff.id,
            bank_name: b.bankName,
            account_number: b.accountNumber,
            account_name: b.accountName,
            is_primary: b.isPrimary,
          }))
        );
      }

      await supabase.from("transport_staff_plates").delete().eq("staff_id", staff.id);
      if (staff.plates && staff.plates.length > 0) {
        await supabase.from("transport_staff_plates").insert(
          staff.plates.map((p) => ({
            id: p.id,
            staff_id: staff.id,
            plate_number: p.plateNumber,
          }))
        );
      }

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
      if (error) throw error;
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
