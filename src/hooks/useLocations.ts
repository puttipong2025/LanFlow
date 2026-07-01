import { useQuery } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Location } from "@/types";

export function useLocations() {
  const supabase = createSupabaseBrowserClient();

  const query = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("*")
        .order("name", { ascending: true });

      if (error) throw new Error(error.message || JSON.stringify(error));
      
      return (data || []).map((row: any): Location => ({
        id: row.id,
        name: row.name,
        code: row.code,
        active: row.active
      }));
    },
  });

  return {
    locations: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
  };
}