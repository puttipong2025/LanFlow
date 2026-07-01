"use client";

import { useState } from "react";
import { UserCheck, UserX } from "lucide-react";
import type { MoneyTransferItem, OcrTicket, RubberBill } from "@/types";
import { formatCurrency } from "@/lib/format";

export function ItemPicker({
  bills,
  ocrTickets,
  usedSourceIds,
  selectedItems,
  onSelect,
  onDeselect,
}: {
  bills: RubberBill[];
  ocrTickets: OcrTicket[];
  usedSourceIds: Set<string>;
  selectedItems: MoneyTransferItem[];
  onSelect: (item: MoneyTransferItem) => void;
  onDeselect: (sourceId: string) => void;
}) {
  const [tab, setTab] = useState<"rubber" | "ocr">("rubber");
  const selectedSourceIds = new Set(selectedItems.map((i) => i.sourceId));

  const activeBills = bills.filter((b) => b.recordStatus !== "deleted");
  const activeTickets = ocrTickets.filter((t) => t.recordStatus !== "deleted");

  return (
    <div className="rounded-lg border border-leaf/20 bg-leaf/5 p-3">
      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={() => setTab("rubber")}
          className={`rounded-md px-3 py-1.5 text-sm font-semibold ${tab === "rubber" ? "bg-leaf text-white" : "bg-white text-ink hover:bg-field"}`}
        >
          บิลยาง ({activeBills.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("ocr")}
          className={`rounded-md px-3 py-1.5 text-sm font-semibold ${tab === "ocr" ? "bg-river text-white" : "bg-white text-ink hover:bg-field"}`}
        >
          ใบชั่ง ({activeTickets.length})
        </button>
      </div>

      <div className="max-h-72 overflow-y-auto rounded-lg border border-black/10 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-black/5 bg-field/60 text-left text-xs font-bold text-ink/50">
              <th className="px-3 py-2">เลือก</th>
              {tab === "rubber" ? (
                <>
                  <th className="px-3 py-2">เลขบิล</th>
                  <th className="px-3 py-2">ลูกค้า</th>
                  <th className="px-3 py-2">วันที่</th>
                  <th className="px-3 py-2 text-right">ยอดสุทธิ (฿)</th>
                </>
              ) : (
                <>
                  <th className="px-3 py-2">เลขที่</th>
                  <th className="px-3 py-2">ลูกค้า</th>
                  <th className="px-3 py-2">ทะเบียน</th>
                  <th className="px-3 py-2 text-right">ยอดเงิน (฿)</th>
                </>
              )}
              <th className="px-3 py-2 text-center">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {tab === "rubber" &&
              activeBills.map((bill) => {
                const alreadyUsed = usedSourceIds.has(bill.id);
                const alreadySelected = selectedSourceIds.has(bill.id);
                const noCustomer = !bill.customerName;
                const negative = bill.netTotal < 0;
                const disabled = alreadyUsed || noCustomer || negative;

                return (
                  <tr key={bill.id} className={`border-b border-black/5 ${disabled && !alreadySelected ? "opacity-50" : ""}`}>
                    <td className="px-3 py-2">
                      {alreadySelected ? (
                        <button type="button" onClick={() => onDeselect(bill.id)} className="rounded bg-leaf px-2 py-0.5 text-xs font-bold text-white">
                          ✓
                        </button>
                      ) : disabled ? (
                        <span className="rounded bg-field px-2 py-0.5 text-xs font-bold text-ink/30">—</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            onSelect({
                              id: crypto.randomUUID(),
                              sourceType: "rubber_bill",
                              sourceId: bill.id,
                              customerName: bill.customerName,
                              amount: bill.netTotal,
                            })
                          }
                          className="rounded bg-leaf/10 px-2 py-0.5 text-xs font-bold text-leaf hover:bg-leaf/20"
                        >
                          เลือก
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono font-semibold">{bill.billNo}</td>
                    <td className="px-3 py-2">
                      {bill.customerName ? (
                        <span className="inline-flex items-center gap-1 text-xs"><UserCheck size={12} className="text-leaf" /> {bill.customerName}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-clay"><UserX size={12} /> ไม่มีชื่อ</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink/60">{bill.billDate}</td>
                    <td className={`px-3 py-2 text-right font-mono font-bold ${negative ? "text-clay" : "text-river"}`}>
                      {formatCurrency(bill.netTotal)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {alreadyUsed && !alreadySelected ? (
                        <span className="rounded-full bg-amber/20 px-2 py-0.5 text-xs font-bold text-amber">โอนแล้ว</span>
                      ) : noCustomer ? (
                        <span className="rounded-full bg-clay/10 px-2 py-0.5 text-xs font-bold text-clay">ไม่มีชื่อ</span>
                      ) : negative ? (
                        <span className="rounded-full bg-clay/10 px-2 py-0.5 text-xs font-bold text-clay">ติดลบ</span>
                      ) : (
                        <span className="rounded-full bg-leaf/10 px-2 py-0.5 text-xs font-bold text-leaf">พร้อม</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            {tab === "ocr" &&
              activeTickets.map((ticket) => {
                const alreadyUsed = usedSourceIds.has(ticket.id);
                const alreadySelected = selectedSourceIds.has(ticket.id);
                const noCustomer = !ticket.customerName;
                const amount = ticket.totalAmount ?? 0;
                const negative = amount < 0;
                const disabled = alreadyUsed || noCustomer || negative;

                return (
                  <tr key={ticket.id} className={`border-b border-black/5 ${disabled && !alreadySelected ? "opacity-50" : ""}`}>
                    <td className="px-3 py-2">
                      {alreadySelected ? (
                        <button type="button" onClick={() => onDeselect(ticket.id)} className="rounded bg-river px-2 py-0.5 text-xs font-bold text-white">
                          ✓
                        </button>
                      ) : disabled ? (
                        <span className="rounded bg-field px-2 py-0.5 text-xs font-bold text-ink/30">—</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            onSelect({
                              id: crypto.randomUUID(),
                              sourceType: "ocr_ticket",
                              sourceId: ticket.id,
                              customerName: ticket.customerName ?? null,
                              amount,
                            })
                          }
                          className="rounded bg-river/10 px-2 py-0.5 text-xs font-bold text-river hover:bg-river/20"
                        >
                          เลือก
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono font-semibold">{ticket.ticketId ?? "—"}</td>
                    <td className="px-3 py-2">
                      {ticket.customerName ? (
                        <span className="inline-flex items-center gap-1 text-xs"><UserCheck size={12} className="text-leaf" /> {ticket.customerName}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-clay"><UserX size={12} /> ไม่มีชื่อ</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-ink/60">{ticket.licensePlate ?? "—"}</td>
                    <td className={`px-3 py-2 text-right font-mono font-bold ${negative ? "text-clay" : "text-river"}`}>
                      {formatCurrency(amount)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {alreadyUsed && !alreadySelected ? (
                        <span className="rounded-full bg-amber/20 px-2 py-0.5 text-xs font-bold text-amber">โอนแล้ว</span>
                      ) : noCustomer ? (
                        <span className="rounded-full bg-clay/10 px-2 py-0.5 text-xs font-bold text-clay">ไม่มีชื่อ</span>
                      ) : negative ? (
                        <span className="rounded-full bg-clay/10 px-2 py-0.5 text-xs font-bold text-clay">ติดลบ</span>
                      ) : (
                        <span className="rounded-full bg-leaf/10 px-2 py-0.5 text-xs font-bold text-leaf">พร้อม</span>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
        {tab === "rubber" && activeBills.length === 0 && (
          <p className="py-6 text-center text-sm text-ink/40">ไม่มีบิลยาง</p>
        )}
        {tab === "ocr" && activeTickets.length === 0 && (
          <p className="py-6 text-center text-sm text-ink/40">ไม่มีใบชั่ง</p>
        )}
      </div>
    </div>
  );
}
