import { expect, test } from "@playwright/test";

import {
  buildWeighingAppointmentTicket,
  renderWeighingAppointmentHtml,
  WEIGHING_WAIT_OPTIONS,
} from "../src/lib/rubber-bills/weighing-appointment";

test.describe("Weighing appointment ticket", () => {
  test("offers only the confirmed wait presets", () => {
    expect(WEIGHING_WAIT_OPTIONS).toEqual([5, 10, 15, 30, 40, 60, 120, 180]);
  });

  test("calculates and formats the appointment in Bangkok time", () => {
    const ticket = buildWeighingAppointmentTicket(40, new Date("2026-07-25T07:10:00.000Z"));

    expect(ticket).toEqual({
      waitMinutes: 40,
      issuedDate: "25/07/2569",
      issuedTime: "14:10",
      appointmentDate: "25/07/2569",
      appointmentTime: "14:50",
      isNextDay: false,
    });
  });

  test("marks an appointment that crosses midnight as the next day", () => {
    const ticket = buildWeighingAppointmentTicket(60, new Date("2026-07-25T16:30:00.000Z"));
    const html = renderWeighingAppointmentHtml(ticket);

    expect(ticket.appointmentDate).toBe("26/07/2569");
    expect(ticket.appointmentTime).toBe("00:30");
    expect(ticket.isNextDay).toBe(true);
    expect(html).toContain("@page { size: 80mm auto;");
    expect(html).toContain("เวลาที่ออกบัตร");
    expect(html).toContain("ระยะเวลารอ");
    expect(html).toContain("ชั่งเวลา 00:30 น.");
    expect(html).toContain("(วันถัดไป)");
  });
});
