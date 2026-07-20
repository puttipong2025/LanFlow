import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AcidProduct } from "@/types";
import { STOCK_PRODUCT_APPROVAL_REQUESTS_KEY } from "@/hooks/useStockProductApprovals";

const QUERY_KEY = "stockProducts";

function mapProduct(row: any): AcidProduct {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    isActive: row.is_active,
    createdByName: row.created_by_name,
    createdByPhone: row.created_by_phone,
    createdAt: row.created_at,
  };
}

function makeRequestKey(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}:${crypto.randomUUID()}`;
  }
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

async function postStockProduct(input: { name: string; unit: string; createSaleItem?: boolean }) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("เพิ่มสินค้าต้องออนไลน์ก่อน");
  }

  const response = await fetch("/api/lanflow/stock-product-approval-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestType: "create_product",
      requestIdempotencyKey: makeRequestKey("create-stock-product"),
      ...input,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.errorMessage || data.error || "เพิ่มสินค้าไม่สำเร็จ");
  }
  if (data.status !== "pending") {
    throw new Error(data.errorMessage || "เพิ่มสินค้าไม่สำเร็จ");
  }

  return data;
}

async function postStockProductDelete(input: { productId: string }) {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("ลบสินค้าต้องออนไลน์ก่อน");
  }

  const response = await fetch("/api/lanflow/stock-product-approval-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestType: "delete_product",
      requestIdempotencyKey: makeRequestKey("delete-stock-product"),
      productId: input.productId,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.errorMessage || data.error || "ส่งคำขอลบสินค้าไม่สำเร็จ");
  }

  if (data.status !== "pending") {
    throw new Error(data.errorMessage || "ส่งคำขอลบสินค้าไม่สำเร็จ");
  }

  return data;
}

export function useAcidProducts({ includeInactive = false }: { includeInactive?: boolean } = {}) {
  const supabase = createSupabaseBrowserClient();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [QUERY_KEY, { includeInactive }],
    queryFn: async () => {
      let q = supabase
        .from("stock_products")
        .select("*")
        .order("name", { ascending: true });

      if (!includeInactive) {
        q = q.eq("is_active", true);
      }

      const { data, error } = await q;
      if (error) throw new Error(error.message || JSON.stringify(error));
      return (data || []).map(mapProduct);
    },
  });

  const addProductMutation = useMutation({
    mutationFn: postStockProduct,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: ["incomeSaleItems"] });
      queryClient.invalidateQueries({ queryKey: [STOCK_PRODUCT_APPROVAL_REQUESTS_KEY] });
    },
  });

  const deleteProductMutation = useMutation({
    mutationFn: postStockProductDelete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [STOCK_PRODUCT_APPROVAL_REQUESTS_KEY] });
    },
  });

  return {
    products: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    addProduct: addProductMutation.mutateAsync,
    deleteProduct: deleteProductMutation.mutateAsync,
  };
}
