import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";
import {
  OCR_SLIP_IMAGE_TYPES,
  OCR_SLIP_MAX_IMAGE_BYTES,
  parseOcrSlipResponseText,
} from "@/lib/server/ocr-slip";

export const dynamic = "force-dynamic";


const OCR_SLIP_PROMPT = `คุณคือผู้เชี่ยวชาญด้าน OCR ที่เชี่ยวชาญในการอ่านสลิปโอนเงินธนาคารของไทย

รูปภาพที่ส่งมานี้จะเป็นสลิปการโอนเงิน/เติมเงิน/ชำระเงิน จงวิเคราะห์รูปภาพและสกัดข้อมูลเฉพาะฟิลด์ที่ระบุต่อไปนี้ โดยส่งผลลัพธ์กลับมาเป็น JSON Object เพียงอย่างเดียว ห้ามใส่เครื่องหมาย markdown ครอบ เช่น \`\`\`json หรือ \`\`\` โดยเด็ดขาด

หากฟิลด์ใดไม่มีข้อมูลหรือไม่สามารถอ่านได้ ให้กำหนดค่าเป็น null สำหรับข้อมูลที่เป็นตัวเลข ให้ตัดเครื่องหมายจุลภาค (,) และหน่วยออก ให้เหลือเฉพาะตัวเลขล้วน

ฟิลด์ที่ต้องสกัดข้อมูล:
1. "amount": จำนวนเงินที่โอน (หน่วยเป็นบาท เป็นตัวเลข เช่น 15000.00)
2. "reference_number": หมายเลขอ้างอิง/เลขที่อ้างอิง/Reference No./รหัสอ้างอิง (ส่วนใหญ่ 10-30 ตัวอักษรภาษาอังกฤษและตัวเลข)
3. "fee": ค่าธรรมเนียม (หน่วยเป็นบาท เป็นตัวเลข ถ้าไม่มีหรือฟรีให้ส่ง 0)
4. "sender_name": ชื่อผู้โอน/ผู้ส่ง/จาก
5. "receiver_name": ชื่อผู้รับ/ผู้รับเงิน/ไปยัง/ไปที่
6. "transaction_date": วันเวลาที่ทำรายการสำเร็จ ในรูปแบบ ISO 8601 (YYYY-MM-DDTHH:mm:ss) ให้แปลงปี พ.ศ. เป็น ค.ศ. โดยลบ 543

ตัวอย่างผลลัพธ์ที่ถูกต้อง:
{"amount":15000.00,"reference_number":"2025062212345678","fee":0,"sender_name":"นายสมชาย ใจดี","receiver_name":"นางสมหญิง รักดี","transaction_date":"2025-06-22T10:30:00"}

สำคัญ:
- ส่งเฉพาะ JSON เท่านั้น ห้ามมี text อื่นใด
- ห้ามใส่ markdown code block (\`\`\`)
- ตัวเลขทุกตัวต้องเป็นตัวเลขล้วน ไม่มีจุลภาค ไม่มีหน่วย
- reference_number ต้องเป็น string เสมอ`;

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData().catch(() => null);
    const file = formData?.get("image");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "กรุณาส่งรูปภาพสลิปมาด้วย (field name: image)" },
        { status: 400 }
      );
    }
    if (
      !OCR_SLIP_IMAGE_TYPES.has(file.type)
      || file.size <= 0
      || file.size > OCR_SLIP_MAX_IMAGE_BYTES
    ) {
      return NextResponse.json(
        { error: "รองรับเฉพาะ JPEG, PNG หรือ WebP ขนาดไม่เกิน 8 MB" },
        { status: 400 },
      );
    }
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ระบบ OCR ยังไม่ได้ตั้งค่า" }, { status: 503 });
    }
    const model = process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash";

    // Convert file to base64 data URL
    const arrayBuffer = await file.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString("base64");
    const dataUrl = `data:${file.type};base64,${base64Data}`;

    // Call OpenRouter API
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://lanflow.vercel.app",
        "X-Title": "LanFlow OCR Slip",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: OCR_SLIP_PROMPT },
              {
                type: "image_url",
                image_url: { url: dataUrl },
              },
            ],
          },
        ],
        max_tokens: 1024,
        temperature: 0,
      }),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: response.status === 429 ? "ระบบ OCR มีงานมาก กรุณาลองใหม่" : "ระบบ OCR ประมวลผลไม่สำเร็จ" },
        { status: response.status === 429 ? 429 : 503 },
      );
    }

    const data = await response.json().catch(() => null) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    } | null;
    const responseText = data?.choices?.[0]?.message?.content;
    if (typeof responseText !== "string") {
      return NextResponse.json({ error: "ผล OCR ไม่อยู่ในรูปแบบที่ใช้ได้" }, { status: 422 });
    }
    try {
      return NextResponse.json(parseOcrSlipResponseText(responseText));
    } catch {
      return NextResponse.json({ error: "ผล OCR ไม่อยู่ในรูปแบบที่ใช้ได้" }, { status: 422 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    console.error("OCR Slip API Error:", message);
    return NextResponse.json(
      { error: error instanceof DOMException && error.name === "TimeoutError"
        ? "ระบบ OCR ใช้เวลานานเกินกำหนด กรุณาลองใหม่"
        : "เชื่อมต่อระบบ OCR ไม่สำเร็จ" },
      { status: 503 },
    );
  }
}
