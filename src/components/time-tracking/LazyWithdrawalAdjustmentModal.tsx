"use client";

import dynamic from "next/dynamic";

export const LazyWithdrawalAdjustmentModal = dynamic(
  () => import("./WithdrawalAdjustmentModal").then((module) => module.WithdrawalAdjustmentModal),
  { ssr: false },
);
