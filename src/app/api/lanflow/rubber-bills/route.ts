import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth(request);
    if (!authResult.ok) {
      return authResult.response;
    }

    const raw = await request.text();
    if (!raw) {
      return NextResponse.json({ status: "failed", errorMessage: "ไม่มีข้อมูลบิลยางสำหรับซิงก์" }, { status: 400 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return NextResponse.json({ status: "failed", errorMessage: "รูปแบบข้อมูลบิลยางไม่ถูกต้อง" }, { status: 400 });
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return NextResponse.json({ status: "failed", errorMessage: "ข้อมูลบิลยางสำหรับซิงก์ไม่ถูกต้อง" }, { status: 400 });
    }

    const { data, error } = await authResult.supabase.rpc("sync_rubber_bill", { payload });
    if (error) {
      console.error("Rubber Bill sync RPC failed", error.code ?? "unknown");
      return NextResponse.json(
        { status: "failed", errorMessage: "ระบบซิงก์บิลยางไม่พร้อมใช้งานชั่วคราว" },
        { status: 503 },
      );
    }
    if (!data || typeof data !== "object") {
      return NextResponse.json({ status: "failed", errorMessage: "ระบบซิงก์บิลยางไม่ตอบกลับ" }, { status: 503 });
    }

    const result = data as Record<string, unknown>;
    const status = typeof result.status === "string" ? result.status : "failed";
    const responseStatus = status === "conflict" ? 409 : status === "failed" ? 400 : 200;
    return NextResponse.json(result, {
      status: responseStatus,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    console.error("Rubber Bill sync route failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json(
      { status: "failed", errorMessage: "ระบบซิงก์บิลยางไม่พร้อมใช้งานชั่วคราว" },
      { status: 503 },
    );
  }
}
