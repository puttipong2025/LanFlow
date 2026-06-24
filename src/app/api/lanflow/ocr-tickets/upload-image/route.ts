import { NextRequest, NextResponse } from "next/server";
import { uploadImageToDrive } from "@/lib/server/google-drive";
import { updateOcrTicket } from "@/lib/server/lanflow-db";
import { requireAuth } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/**
 * POST /api/lanflow/ocr-tickets/upload-image
 * Uploads an image to Google Drive and updates the OCR ticket with the Drive link.
 * Body: multipart/form-data with fields: image (File), ticketId (string)
 */
export async function POST(request: NextRequest) {
  const result = await requireAuth(request);
  if (!result.ok) return result.response;

  try {
    const formData = await request.formData();
    const file = formData.get("image") as File | null;
    const ticketId = formData.get("ticketId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "กรุณาส่งรูปภาพ (field: image)" }, { status: 400 });
    }
    if (!ticketId) {
      return NextResponse.json({ error: "กรุณาส่ง ticketId" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = file.type || "image/jpeg";

    const { fileId, webViewLink } = await uploadImageToDrive(buffer, mimeType, file.name);

    // Update ticket in DB with drive info
    const updated = await updateOcrTicket(result.supabase, ticketId, {
      driveFileId: fileId,
      driveUrl: webViewLink,
    }, result.auth.sub);

    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    console.error("Drive upload error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
