import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import {
  isIncomeExpenseSubmission,
  isIncomeExpenseSyncResult,
  publicIncomeExpenseErrorMessage,
} from "@/lib/income-expense/contracts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const result = await requireAuth(request);
    if (!result.ok) return result.response;
    const supabase = result.supabase;

    const raw = await request.text();
    if (!raw) {
      return NextResponse.json({ status: "failed", errorMessage: "Empty sync payload" }, { status: 400 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      return NextResponse.json({ status: "failed", errorMessage: "Invalid JSON payload" }, { status: 400 });
    }
    if (!isIncomeExpenseSubmission(payload)) {
      return NextResponse.json(
        { status: "failed", errorMessage: "ข้อมูลอ้างอิงการซิงก์รับ-จ่ายไม่ถูกต้อง" },
        { status: 400 },
      );
    }

    const { data, error } = await supabase.rpc("sync_income_expense", { payload });

    if (error) {
      console.error("RPC sync_income_expense error:", error);
      return NextResponse.json(
        { status: "failed", errorMessage: "บันทึกรายการรับ-จ่ายไม่สำเร็จ" },
        { status: 503 },
      );
    }

    if (!isIncomeExpenseSyncResult(data, payload)) {
      return NextResponse.json(
        { status: "failed", errorMessage: "ระบบซิงก์รับ-จ่ายไม่ตอบกลับตามรูปแบบที่กำหนด" },
        { status: 503 },
      );
    }

    const status = data.status;
    const responsePayload = status === "failed" || status === "conflict"
      ? { ...data, errorMessage: publicIncomeExpenseErrorMessage(data.errorMessage, "บันทึกรายการรับ-จ่ายไม่สำเร็จ") }
      : data;

    if (status === "synced") {
      return NextResponse.json(responsePayload, { status: 200 });
    } else if (status === "pending_approval") {
      return NextResponse.json(responsePayload, { status: 202 });
    } else if (status === "failed") {
      return NextResponse.json(responsePayload, { status: 400 });
    } else if (status === "conflict") {
      return NextResponse.json(responsePayload, { status: 409 });
    }
    return NextResponse.json(
      { status: "failed", errorMessage: "ระบบซิงก์รับ-จ่ายไม่ตอบกลับตามรูปแบบที่กำหนด" },
      { status: 503 },
    );

  } catch (err: unknown) {
    console.error("Sync income-expense API error:", err);
    return NextResponse.json(
      { status: "failed", errorMessage: "บันทึกรายการรับ-จ่ายไม่สำเร็จ" },
      { status: 503 },
    );
  }
}
