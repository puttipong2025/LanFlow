import { NextRequest, NextResponse } from "next/server";
import { uploadImageToDrive } from "@/lib/server/google-drive";
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

    const { fileId: driveFileId } = await uploadImageToDrive(buffer, mimeType, file.name);

    // Update ticket in DB with drive info
    const driveUrl = `https://drive.google.com/open?id=${driveFileId}`;

    const { data: updatedTicket, error } = await result.supabase
      .from("ocr_tickets")
      .update({
        drive_file_id: driveFileId,
        drive_url: driveUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", ticketId)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(updatedTicket);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    console.error("Drive upload error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
