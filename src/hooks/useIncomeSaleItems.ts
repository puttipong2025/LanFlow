import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { IncomeSaleItem } from "@/types";

export function useIncomeSaleItems({ includeInactive = false }: { includeInactive?: boolean } = {}) {
  const supabase = createSupabaseBrowserClient();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["incomeSaleItems", { includeInactive }],
    queryFn: async () => {
      let q = supabase
        .from("income_sale_items")
        .select("*")
        .order("name", { ascending: true });

      if (!includeInactive) {
        q = q.eq("is_active", true);
      }

      const { data, error } = await q;

      if (error) throw new Error(error.message || JSON.stringify(error));
      
      return data.map((row: any) => ({
        id: row.id,
        name: row.name,
        isActive: row.is_active,
        createdByName: row.created_by_name,
        createdByPhone: row.created_by_phone,
        createdAt: row.created_at,
      })) as IncomeSaleItem[];
    },
  });

  const addItemMutation = useMutation({
    mutationFn: async (name: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      
      let createdByName = "";
      let createdByPhone = "";
      if (session?.user) {
         const { data: profile } = await supabase.from("profiles").select("name, phone").eq("id", session.user.id).single();
         if (profile) {
             createdByName = profile.name;
             createdByPhone = profile.phone;
         }
      }

      const { data, error } = await supabase
        .from("income_sale_items")
        .insert({
          name,
          created_by_user_id: session?.user?.id,
          created_by_name: createdByName,
          created_by_phone: createdByPhone,
        })
        .select()
        .single();
        
      if (error) throw new Error(error.message || JSON.stringify(error));
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incomeSaleItems"] });
    }
  });

  const disableItemMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      const { error } = await supabase
        .from("income_sale_items")
        .update({
          is_active: false,
          deleted_at: new Date().toISOString(),
          deleted_by_user_id: session?.user?.id
        })
        .eq("id", id);
        
      if (error) throw new Error(error.message || JSON.stringify(error));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incomeSaleItems"] });
    }
  });

  const deleteItemMutation = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { error } = await supabase.rpc("delete_income_sale_item", { item_id: id });
      if (error) throw new Error(error.message || JSON.stringify(error));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["incomeSaleItems"] });
    }
  });

  return {
    items: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    addItem: addItemMutation.mutateAsync,
    disableItem: disableItemMutation.mutateAsync,
    deleteItem: deleteItemMutation.mutateAsync,
  };
}
