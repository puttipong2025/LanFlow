"use client";

import dynamic from "next/dynamic";

export const LazyExpenseLocationChangeModal = dynamic(
  () => import("./ExpenseLocationChangeModal").then((module) => module.ExpenseLocationChangeModal),
  { ssr: false },
);
