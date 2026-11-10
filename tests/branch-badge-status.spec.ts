import { expect, test } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadSourceModule } from "./helpers/load-source-module";
import { branchBadgeStatusEntries } from "../src/lib/branch-badge-status";
import type { ModuleBadgeCounts } from "../src/hooks/useActionableBadges";

const { BranchBadgeSummary } = loadSourceModule<typeof import("../src/components/lanflow/BranchBadgeSummary")>(
  "src/components/lanflow/BranchBadgeSummary.tsx", {},
);
const textContent = (html: string) => html.replace(/<[^>]*>/g, "");

test("two groups use the existing module snapshot without duplicating transfers or browser requests", () => {
  const counts = {
    "money-transfer": 6, rubber: 5, cash: 4, "rubber-evidence": 2,
    "rubber-export": 3, "acid-stock": 1, "time-tracking": 7,
  };
  const entries = branchBadgeStatusEntries(counts, 2);
  expect(entries).toEqual([
    { status: "transfer", label: "รอโอน", count: 6 },
    { status: "other", label: "รอจัดการ", count: 24 },
  ]);
  expect(entries?.reduce((sum, entry) => sum + entry.count, 0))
    .toBe(Object.values(counts).reduce((sum, count) => sum + count, 0) + 2);
});

test("zero groups are omitted and counts above 99 remain exact", () => {
  expect(branchBadgeStatusEntries({ "money-transfer": 125, cash: 0 }, 2)).toEqual([
    { status: "transfer", label: "รอโอน", count: 125 },
    { status: "other", label: "รอจัดการ", count: 2 },
  ]);
  expect(branchBadgeStatusEntries()).toEqual([]);
  expect(branchBadgeStatusEntries({ cash: 7 })).toEqual([{ status: "other", label: "รอจัดการ", count: 7 }]);
});

test("updating the shared source immediately updates both groups without a second cache", () => {
  const render = (counts: ModuleBadgeCounts) => renderToStaticMarkup(createElement(BranchBadgeSummary, {
    counts, browserCount: 0, fallbackTotal: 0, unavailable: false,
  }));
  expect(textContent(render({ "money-transfer": 3, cash: 7 }))).toContain("รอโอน 3");
  const updated = render({ "money-transfer": 0, cash: 2 });
  expect(updated).not.toContain("รอโอน");
  expect(textContent(updated)).toContain("รอจัดการ 2");
  expect(updated).toContain("มีงาน 2 รายการ");
});

test("overflow across otherwise valid category counts cannot crash the header", () => {
  for (const counts of [
    { "money-transfer": Number.MAX_SAFE_INTEGER, cash: 1 },
    { cash: Number.MAX_SAFE_INTEGER, rubber: 1 },
  ]) {
    expect(branchBadgeStatusEntries(counts)).toBeNull();
    const html = renderToStaticMarkup(createElement(BranchBadgeSummary, {
      counts, browserCount: 0, fallbackTotal: 10, unavailable: false,
    }));
    expect(html).toContain("มีงาน 10 รายการ");
    expect(html).toContain("โหลดรายละเอียดสถานะไม่ได้");
    expect(html).not.toContain("data-branch-status-group");
  }
});

for (const invalid of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid module or browser count uses the fallback: ${invalid}`, () => {
    expect(branchBadgeStatusEntries({ cash: invalid })).toBeNull();
    expect(branchBadgeStatusEntries({}, invalid)).toBeNull();
  });
}

test("loaded summaries expose exactly two labels and the matching accessible total", () => {
  const html = renderToStaticMarkup(createElement(BranchBadgeSummary, {
    counts: { "money-transfer": 3, cash: 7 }, browserCount: 2,
    fallbackTotal: 99, unavailable: false,
  }));
  expect(html).toContain("มีงาน 12 รายการ");
  expect(textContent(html)).toContain("รอโอน 3");
  expect(textContent(html)).toContain("รอจัดการ 9");
  expect(html).not.toContain("รออนุมัติ");
  expect(html).not.toContain("data-branch-badge");
  expect(html.match(/data-branch-status-group=/g)).toHaveLength(2);
});

test("failed source hides stale groups and retains only a valid fallback", () => {
  for (const fallbackTotal of [10, NaN, -1]) {
    const html = renderToStaticMarkup(createElement(BranchBadgeSummary, {
      counts: { "money-transfer": 3 }, browserCount: 0, fallbackTotal, unavailable: true,
    }));
    expect(html).toContain("โหลดรายละเอียดสถานะไม่ได้");
    expect(html).not.toContain("รอโอน");
    if (fallbackTotal === 10) expect(html).toContain("มีงาน 10 รายการ");
    else expect(html).not.toContain("data-branch-badge");
  }
});
