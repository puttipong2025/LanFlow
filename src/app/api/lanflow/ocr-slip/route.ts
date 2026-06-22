import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash";

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
  try {
    const formData = await request.formData();
    const file = formData.get("image") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "กรุณาส่งรูปภาพสลิปมาด้วย (field name: image)" },
        { status: 400 }
      );
    }

    // Convert file to base64 data URL
    const arrayBuffer = await file.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = file.type || "image/jpeg";
    const dataUrl = `data:${mimeType};base64,${base64Data}`;

    // Call OpenRouter API
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://lanflow.vercel.app",
        "X-Title": "LanFlow OCR Slip",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
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
      const errorBody = await response.text();
      throw new Error(`OpenRouter API error (${response.status}): ${errorBody}`);
    }

    const data = await response.json();
    const responseText = (data.choices?.[0]?.message?.content ?? "").trim();

    // Try to parse as JSON
    let parsedResult;
    try {
      let cleanText = responseText;
      if (cleanText.startsWith("```json")) {
        cleanText = cleanText.slice(7);
      } else if (cleanText.startsWith("```")) {
        cleanText = cleanText.slice(3);
      }
      if (cleanText.endsWith("```")) {
        cleanText = cleanText.slice(0, -3);
      }
      cleanText = cleanText.trim();
      parsedResult = JSON.parse(cleanText);
    } catch {
      return NextResponse.json(
        {
          error: "ไม่สามารถแปลงผลลัพธ์เป็น JSON ได้",
          raw_response: responseText,
        },
        { status: 422 }
      );
    }

    return NextResponse.json(parsedResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    console.error("OCR Slip API Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
