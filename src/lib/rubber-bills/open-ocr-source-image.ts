import { authFetch } from "@/lib/auth-fetch";

export async function openRubberBillOcrSourceImage(billId: string) {
  const previewWindow = window.open("", "_blank");
  if (!previewWindow) throw new Error("เบราว์เซอร์บล็อกการเปิดรูปต้นฉบับ");
  previewWindow.opener = null;

  try {
    const response = await authFetch(`/api/lanflow/rubber-bills/${encodeURIComponent(billId)}/ocr-source-image`);
    if (!response.ok) throw new Error("เปิดรูปต้นฉบับจาก OCR ไม่สำเร็จ");
    const url = URL.createObjectURL(await response.blob());
    previewWindow.location.href = url;
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    previewWindow.close();
    throw error;
  }
}
