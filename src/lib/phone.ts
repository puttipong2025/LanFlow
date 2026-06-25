export function normalizeThaiPhoneToE164(input: string): string {
  const digits = input.replace(/\D/g, "");

  if (/^0\d{9}$/.test(digits)) {
    return `+66${digits.slice(1)}`;
  }

  if (/^66\d{9}$/.test(digits)) {
    return `+${digits}`;
  }

  if (/^\d{10,15}$/.test(digits) && input.trim().startsWith("+")) {
    return `+${digits}`;
  }

  throw new Error("กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง");
}

