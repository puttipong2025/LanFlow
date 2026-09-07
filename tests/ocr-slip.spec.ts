import { expect, test } from "@playwright/test";

import {
  OCR_SLIP_IMAGE_TYPES,
  OCR_SLIP_MAX_IMAGE_BYTES,
  parseOcrSlipResponseText,
} from "../src/lib/server/ocr-slip";

test("normalizes a bounded OCR slip response", () => {
  expect(parseOcrSlipResponseText(`\`\`\`json
    {"amount":"1250.50","reference_number":" ABC-123 ","fee":0,"sender_name":" ผู้ส่ง ","receiver_name":null,"transaction_date":"2026-09-06T14:30:00"}
  \`\`\``)).toEqual({
    amount: 1250.5,
    reference_number: "ABC-123",
    fee: 0,
    sender_name: "ผู้ส่ง",
    receiver_name: null,
    transaction_date: "2026-09-06T14:30:00",
  });
  expect(OCR_SLIP_IMAGE_TYPES).toEqual(new Set(["image/jpeg", "image/png", "image/webp"]));
  expect(OCR_SLIP_MAX_IMAGE_BYTES).toBe(8 * 1024 * 1024);
});

test("rejects malformed, unreadable, and unsafe OCR output", () => {
  for (const value of [
    "not json",
    "[]",
    '{"amount":-1,"fee":0}',
    '{"amount":null,"fee":0,"reference_number":null,"sender_name":null,"receiver_name":null,"transaction_date":null}',
    '{"amount":1,"transaction_date":"tomorrow"}',
    '{"amount":true}',
    '{"amount":[]}',
    '{"amount":"   "}',
    '{"amount":1,"fee":false}',
    '{"amount":1,"transaction_date":"2026-02-30T14:30:00"}',
    '{"amount":1,"transaction_date":"2026-09-06T24:00:00"}',
  ]) {
    expect(() => parseOcrSlipResponseText(value), value).toThrow(/^OCR_/);
  }
});
