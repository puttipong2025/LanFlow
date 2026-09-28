import { expect, test } from "@playwright/test";

import {
  buildCustomWeighingQueueTicket,
  parseCustomQueueNumber,
  renderCustomWeighingQueueTicketHtml,
  sanitizeCustomQueueNumberInput,
} from "../src/lib/rubber-bills/custom-weighing-queue";

test.describe("Custom weighing queue ticket", () => {
  test("accepts only digits, caps input at four characters, and normalizes leading zeroes", () => {
    expect(sanitizeCustomQueueNumberInput("12a-345")).toBe("1234");
    expect(sanitizeCustomQueueNumberInput("00a07")).toBe("0007");
    expect(parseCustomQueueNumber("0007")).toBe(7);
    expect(parseCustomQueueNumber("1")).toBe(1);
    expect(parseCustomQueueNumber("9999")).toBe(9999);
    expect(parseCustomQueueNumber("")).toBeNull();
    expect(parseCustomQueueNumber("0")).toBeNull();
    expect(parseCustomQueueNumber("10000")).toBeNull();
    expect(parseCustomQueueNumber("1.5")).toBeNull();
    expect(parseCustomQueueNumber("-1")).toBeNull();
  });

  test("renders only the confirmed 80mm ticket fields in Bangkok time", () => {
    const ticket = buildCustomWeighingQueueTicket(7, new Date("2026-07-25T07:10:00.000Z"));
    const html = renderCustomWeighingQueueTicketHtml(ticket);

    expect(ticket).toEqual({
      queueNumber: 7,
      issuedDate: "25/07/2569",
      issuedTime: "14:10",
    });
    expect(html).toContain("@page { size: 80mm auto;");
    expect(html).toContain("<div class=\"title\">บัตรคิว</div>");
    expect(html).toContain("<div class=\"queue-label\">เลขลำดับคิว</div>");
    expect(html).toContain("<div class=\"queue-number\">7</div>");
    expect(html).toContain("ออกบัตร 25/07/2569 เวลา 14:10 น.");
    expect(html).not.toContain("ชื่อลูกค้า");
    expect(html).not.toContain("เวลาชั่ง");
    expect(html).not.toContain("ระยะเวลารอ");
  });

  test("rejects numbers outside the confirmed range", () => {
    expect(() => buildCustomWeighingQueueTicket(0)).toThrow("1–9999");
    expect(() => buildCustomWeighingQueueTicket(10_000)).toThrow("1–9999");
    expect(() => buildCustomWeighingQueueTicket(1.5)).toThrow("1–9999");
  });
});
