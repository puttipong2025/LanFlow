import { useQuery } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Location } from "@/types";

type LocationRow = {
  id: string;
  name: string;
  code: string | null;
  is_active: boolean;
};

export function mapLocationRow(row: LocationRow): Location {
  return {
    id: row.id,
    name: row.name,
    code: row.code ?? "",
    active: row.is_active,
  };
}

export function useLocations() {
  const supabase = createSupabaseBrowserClient();

  const query = useQuery({
    queryKey: ["locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("locations")
        .select("id,name,code,is_active")
        .order("name", { ascending: true });

      if (error) throw new Error(error.message || JSON.stringify(error));

      return (data || []).map(mapLocationRow);
    },
  });

  return {
    locations: query.data || [],
    isLoading: query.isLoading,
    error: query.error,
  };
}
