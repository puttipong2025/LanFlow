import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash";

const OCR_PROMPT = `คุณคือผู้เชี่ยวชาญด้าน OCR ที่เชี่ยวชาญในการอ่านใบชั่งน้ำหนักสินค้าเกษตรของไทย

รูปภาพที่ส่งมานี้จะมีเพียงแค่ 1 บิล (1 ใบชั่งน้ำหนัก) เท่านั้น จงวิเคราะห์รูปภาพและสกัดข้อมูลเฉพาะฟิลด์ที่ระบุต่อไปนี้ โดยส่งผลลัพธ์กลับมาเป็น JSON Object เพียงอย่างเดียว ห้ามใส่เครื่องหมาย markdown ครอบ เช่น \`\`\`json หรือ \`\`\` โดยเด็ดขาด

หากฟิลด์ใดไม่มีข้อมูลหรือไม่สามารถอ่านได้ ให้กำหนดค่าเป็น null สำหรับข้อมูลที่เป็นตัวเลข ให้ตัดเครื่องหมายจุลภาค (,) และหน่วยออก ให้เหลือเฉพาะตัวเลขล้วน (เช่น 2760 แทนที่จะเป็น 2,760 กก.)

ฟิลด์ที่ต้องสกัดข้อมูลจาก 1 บิลนี้:
1. "ticket_id": เลขที่เอกสาร 6 หลัก (เช่น 000923, 000210) — อยู่หลังคำว่า "เลขที่"
2. "license_plate": ทะเบียนรถ (เช่น 1618, 70-4874) — อยู่หลังคำว่า "ทะเบียนรถ"
3. "date_in": วันที่รถเข้า ในรูปแบบ YYYY-MM-DD (ให้แปลงปี พ.ศ. เป็น ค.ศ. โดยลบ 543 เช่น 27/02/2567 → 2024-02-27, 27/02/2024 → 2024-02-27) — อยู่หลังคำว่า "รถเข้า"
4. "weight_in": น้ำหนักเข้า (หน่วยเป็นกิโลกรัม เป็นตัวเลขจำนวนเต็ม) — อยู่หลังคำว่า "น้ำหนักเข้า"
5. "weight_out": น้ำหนักออก (หน่วยเป็นกิโลกรัม เป็นตัวเลขจำนวนเต็ม) — อยู่หลังคำว่า "น้ำหนักออก"
6. "weight_net": น้ำหนักสุทธิ (หน่วยเป็นกิโลกรัม เป็นตัวเลขจำนวนเต็ม) — อยู่หลังคำว่า "น้ำหนักสุทธิ"
7. "weight_deducted": ยอดหักน้ำหนัก (เป็นตัวเลข ถ้าเป็น 0.00 ให้ส่ง 0) — อยู่หลังคำว่า "ยอดหักน้ำหนัก"
8. "weight_remaining": นน.คงเหลือ (หน่วยเป็นกิโลกรัม เป็นตัวเลข) — อยู่หลังคำว่า "นน.คงเหลือ"
9. "total_amount": จำนวนเงินรวมทั้งหมด/คงเหลือ (หน่วยเป็นบาท เป็นตัวเลข) — อยู่หลังคำว่า "คงเหลือ" ในส่วนเงิน (บาท)

ตัวอย่างผลลัพธ์ที่ถูกต้อง:
{"ticket_id":"000923","license_plate":"1618","date_in":"2024-02-27","weight_in":2760,"weight_out":2425,"weight_net":335,"weight_deducted":0,"weight_remaining":335,"total_amount":3350}

สำคัญ:
- ส่งเฉพาะ JSON เท่านั้น ห้ามมี text อื่นใด
- ห้ามใส่ markdown code block (\`\`\`)
- ตัวเลขทุกตัวต้องเป็นตัวเลขล้วน ไม่มีจุลภาค ไม่มีหน่วย
- หากรูปหมุน 90 องศา ให้หมุนกลับก่อนอ่าน`;

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;

  try {
    const formData = await request.formData();
    const file = formData.get("image") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "กรุณาส่งรูปภาพใบชั่งมาด้วย (field name: image)" },
        { status: 400 }
      );
    }

    // Convert file to base64 data URL
    const arrayBuffer = await file.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString("base64");
    const mimeType = file.type || "image/jpeg";
    const dataUrl = `data:${mimeType};base64,${base64Data}`;

    // Call OpenRouter API (OpenAI-compatible)
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://lanflow.vercel.app",
        "X-Title": "LanFlow OCR",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: OCR_PROMPT },
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
    console.error("OCR API Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
