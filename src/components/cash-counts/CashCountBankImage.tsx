"use client";
import { useEffect, useRef, useState } from "react";
import { assertApiResponse, authFetch } from "@/lib/auth-fetch";
import { cn } from "@/lib/cn";

export function CashCountBankImage({ countId, position = 1 }: { countId: string; position?: number }) {
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => () => { if (image) URL.revokeObjectURL(image); }, [image]);
  async function load() {
    if (loading) return;
    if (image) { setImage(null); return; }
    const current = new AbortController(); controller.current = current;
    setLoading(true); setError(null);
    try {
      const response = await authFetch(`/api/lanflow/cash-counts/${countId}/image?position=${position}`, { signal: current.signal });
      await assertApiResponse(response);
      const blob = await response.blob();
      if (!current.signal.aborted) setImage(URL.createObjectURL(blob));
    } catch { if (!current.signal.aborted) setError("โหลดรูปไม่สำเร็จ กรุณาลองใหม่"); }
    finally { if (!current.signal.aborted) setLoading(false); }
  }
  return <div className="space-y-2"><button type="button" disabled={loading} onClick={() => void load()} className={cn("focus-ring min-h-11 rounded-md px-3 text-sm font-semibold text-white disabled:opacity-50", image ? "bg-actionSecondary" : "bg-river")}>{loading ? "กำลังโหลดรูป…" : image ? `ซ่อนรูปบัญชี ${position}` : `ดูรูปบัญชี ${position}`}</button>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {image && <img src={image} alt="หลักฐานยอดบัญชีของการนับครั้งนี้" className="max-h-96 max-w-full rounded-md object-contain" />}
    {error && <p role="alert" className="text-pretty text-sm text-clay">{error}</p>}
  </div>;
}
