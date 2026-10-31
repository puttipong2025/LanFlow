"use client";

import dynamic from "next/dynamic";

export const LazyWithdrawalAdjustmentDelete = dynamic(
  () => import("./WithdrawalAdjustmentDelete").then((module) => module.WithdrawalAdjustmentDelete),
  { ssr: false },
);
