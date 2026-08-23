import { expect, test } from "@playwright/test";

import { orderAccessibleLocations } from "../src/components/lanflow/AppHeader";

test("branch order matches badge, known net cash, then name", () => {
  const locations = [
    { id: "a", name: "อ่างทอง", code: "A", active: true },
    { id: "b", name: "บางนา", code: "B", active: true },
    { id: "c", name: "เชียงใหม่", code: "C", active: true },
  ];
  const ordered = orderAccessibleLocations(locations, { a: 2, b: 2, c: 0 }, (id) => id === "a" ? 100 : id === "b" ? -20 : null);
  expect(ordered.map((location) => location.id)).toEqual(["b", "a", "c"]);
});
