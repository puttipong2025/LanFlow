const DIGITS = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const PLACES = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

function readBelowMillion(value: number) {
  if (value === 0) return "";
  const digits = String(value).split("").map(Number);
  return digits.map((digit, index) => {
    if (digit === 0) return "";
    const place = digits.length - index - 1;
    if (place === 0 && digit === 1 && digits.length > 1) return "เอ็ด";
    if (place === 1 && digit === 1) return "สิบ";
    if (place === 1 && digit === 2) return "ยี่สิบ";
    return `${DIGITS[digit]}${PLACES[place]}`;
  }).join("");
}

function readInteger(value: number): string {
  if (value < 1_000_000) return readBelowMillion(value);
  const high = Math.floor(value / 1_000_000);
  const low = value % 1_000_000;
  return `${readInteger(high)}ล้าน${low === 0 ? "" : readBelowMillion(low)}`;
}

export function thaiBahtText(value: number) {
  if (!Number.isFinite(value)) throw new RangeError("จำนวนเงินต้องเป็นตัวเลขที่มีค่าจำกัด");

  const negative = value < 0;
  const totalSatang = Math.round(Math.abs(value) * 100);
  if (!Number.isSafeInteger(totalSatang)) throw new RangeError("จำนวนเงินมากเกินกว่าที่รองรับ");

  const baht = Math.floor(totalSatang / 100);
  const satang = totalSatang % 100;
  const bahtText = baht === 0 ? "ศูนย์" : readInteger(baht);
  const satangText = satang === 0 ? "ถ้วน" : `${readInteger(satang)}สตางค์`;
  return `${negative ? "ลบ" : ""}${bahtText}บาท${satangText}`;
}
