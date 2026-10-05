import { expect, test } from "@playwright/test";

import {
  buildWeighingAppointmentTicket,
  isWeighingAppointmentDraftCurrentDay,
  renderWeighingAppointmentHtml,
  WEIGHING_WAIT_OPTIONS,
} from "../src/lib/rubber-bills/weighing-appointment";

test.describe("Weighing appointment ticket", () => {
  test("offers only the confirmed wait presets", () => {
    expect(WEIGHING_WAIT_OPTIONS).toEqual([5, 10, 15, 30, 40, 60, 120, 180]);
  });

  test("calculates and formats the appointment in Bangkok time", () => {
    const ticket = buildWeighingAppointmentTicket({
      waitMinutes: 40,
      queueNumber: 7,
      customerName: "  ร้านทดสอบ  ",
      issuedAt: new Date("2026-07-25T07:10:00.000Z"),
    });

    expect(ticket).toEqual({
      waitMinutes: 40,
      queueNumber: 7,
      customerName: "ร้านทดสอบ",
      issuedDate: "25/07/2569",
      issuedTime: "14:10",
      appointmentDate: "25/07/2569",
      appointmentTime: "14:50",
      isNextDay: false,
    });
  });

  test("marks an appointment that crosses midnight as the next day", () => {
    const ticket = buildWeighingAppointmentTicket({
      waitMinutes: 60,
      queueNumber: 8,
      customerName: "   ",
      issuedAt: new Date("2026-07-25T16:30:00.000Z"),
    });
    const html = renderWeighingAppointmentHtml(ticket);

    expect(ticket.appointmentDate).toBe("26/07/2569");
    expect(ticket.appointmentTime).toBe("00:30");
    expect(ticket.isNextDay).toBe(true);
    expect(html).toContain("@page { size: 80mm auto;");
    expect(html).toContain("เวลาที่ออกบัตร");
    expect(html).toContain("ระยะเวลารอ");
    expect(html).toContain("ชั่งเวลา 00:30 น.");
    expect(html).toContain("(วันถัดไป)");
    expect(html.indexOf("เลขคิวบัตรนัด")).toBeLessThan(html.indexOf("เวลานัดชั่ง"));
    expect(html).not.toContain("ชื่อลูกค้า");
  });

  test("renders the queue number first and escapes the optional customer name", () => {
    const ticket = buildWeighingAppointmentTicket({
      waitMinutes: 10,
      queueNumber: 42,
      customerName: "<ร้าน & ลูกค้า>",
      issuedAt: new Date("2026-07-25T07:10:00.000Z"),
    });
    const html = renderWeighingAppointmentHtml(ticket);

    expect(html).toContain(">42<");
    expect(html).toContain("&lt;ร้าน &amp; ลูกค้า&gt;");
    expect(html).not.toContain("<ร้าน & ลูกค้า>");
    expect(html.indexOf("เลขคิวบัตรนัด")).toBeLessThan(html.indexOf("ชื่อลูกค้า"));
    expect(html.indexOf("ชื่อลูกค้า")).toBeLessThan(html.indexOf("เวลานัดชั่ง"));
  });

  test("limits the normalized name to 100 characters and accepts the last queue number", () => {
    const ticket = buildWeighingAppointmentTicket({
      waitMinutes: 5,
      queueNumber: 9_999,
      customerName: `  ${"ก".repeat(101)}  `,
      issuedAt: new Date("2026-07-25T07:10:00.000Z"),
    });

    expect(ticket.queueNumber).toBe(9_999);
    expect(ticket.customerName).toHaveLength(100);
    expect(() => buildWeighingAppointmentTicket({
      waitMinutes: 5,
      queueNumber: 10_000,
    })).toThrow();
  });

  test("invalidates a draft only after the Bangkok calendar day changes", () => {
    const issuedAt = new Date("2026-07-25T16:30:00.000Z");
    expect(isWeighingAppointmentDraftCurrentDay(
      issuedAt,
      new Date("2026-07-25T16:59:59.000Z"),
    )).toBe(true);
    expect(isWeighingAppointmentDraftCurrentDay(
      issuedAt,
      new Date("2026-07-25T17:00:00.000Z"),
    )).toBe(false);
  });
});
