import { NextRequest, NextResponse } from "next/server";
import { updateOcrTicket, deleteOcrTicket } from "@/lib/server/lanflow-db";
import { deleteImageFromDrive } from "@/lib/server/google-drive";

export const dynamic = "force-dynamic";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const updated = await updateOcrTicket(id, body);
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const driveFileId = await deleteOcrTicket(id);

    // Also delete from Google Drive if file was uploaded
    if (driveFileId) {
      await deleteImageFromDrive(driveFileId);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
