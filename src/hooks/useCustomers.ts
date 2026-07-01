import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { Customer } from "@/types";

export function useCustomers() {
  const queryClient = useQueryClient();
  const supabase = createSupabaseBrowserClient();

  const { data: customers, isLoading, error } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select(`
          *,
          customer_contacts (*),
          customer_bank_accounts (*),
          customer_farms (*)
        `)
        .order("created_at", { ascending: false });

      if (error) throw new Error(error.message || JSON.stringify(error));
      
      // Transform Supabase data to our Customer type
      return data.map((row: any) => ({
        id: row.id,
        clientTempId: row.client_temp_id,
        legacyRecId: row.legacy_rec_id,
        legacyMemberId: row.legacy_member_id,
        class: row.class,
        mainName: row.main_name,
        fscStatus: row.fsc_status,
        startingPointsDate: row.starting_points_date,
        defaultLocationId: row.default_location_id,
        createdByUserId: row.created_by_user_id,
        createdByName: row.created_by_name,
        createdByPhone: row.created_by_phone,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        syncStatus: row.sync_status,
        idempotencyKey: row.idempotency_key,
        revisionNo: row.revision_no,
        recordStatus: row.record_status,
        contacts: row.customer_contacts?.map((c: any) => ({
          id: c.id,
          phone: c.phone
        })) || [],
        bankAccounts: row.customer_bank_accounts?.map((b: any) => ({
          id: b.id,
          bankName: b.bank_name,
          accountName: b.account_name,
          accountNumber: b.account_number,
          isPrimary: b.is_primary
        })) || [],
        farms: row.customer_farms?.map((f: any) => ({
          id: f.id,
          titleNumber: f.title_number,
          areaRai: f.area_rai,
          address: f.address,
          latitude: f.latitude,
          longitude: f.longitude
        })) || []
      })) as Customer[];
    }
  });

  const addCustomer = useMutation({
    mutationFn: async (customer: Customer) => {
      const { data, error } = await supabase.from('customers').insert({
        id: customer.id,
        client_temp_id: customer.clientTempId,
        legacy_rec_id: customer.legacyRecId,
        legacy_member_id: customer.legacyMemberId,
        class: customer.class,
        main_name: customer.mainName,
        fsc_status: customer.fscStatus,
        starting_points_date: customer.startingPointsDate,
        default_location_id: customer.defaultLocationId,
        created_by_user_id: customer.createdByUserId,
        created_by_name: customer.createdByName,
        created_by_phone: customer.createdByPhone,
        sync_status: customer.syncStatus,
        idempotency_key: customer.idempotencyKey,
        revision_no: customer.revisionNo,
        record_status: customer.recordStatus
      }).select().single();
      
      if (error) throw new Error(error.message || JSON.stringify(error));
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    }
  });

  const updateCustomer = useMutation({
    mutationFn: async (customer: Customer) => {
      const { data, error } = await supabase.from('customers').update({
        legacy_rec_id: customer.legacyRecId,
        legacy_member_id: customer.legacyMemberId,
        class: customer.class,
        main_name: customer.mainName,
        fsc_status: customer.fscStatus,
        starting_points_date: customer.startingPointsDate,
        default_location_id: customer.defaultLocationId,
        sync_status: customer.syncStatus,
        idempotency_key: customer.idempotencyKey,
        revision_no: customer.revisionNo,
        record_status: customer.recordStatus
      }).eq('id', customer.id).select().single();
      
      if (error) throw new Error(error.message || JSON.stringify(error));
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    }
  });

  const deleteCustomer = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('customers').delete().eq('id', id);
      if (error) throw new Error(error.message || JSON.stringify(error));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
    }
  });

  return {
    customers: customers ?? [],
    isLoading,
    error,
    addCustomer,
    updateCustomer,
    deleteCustomer
  };
}
