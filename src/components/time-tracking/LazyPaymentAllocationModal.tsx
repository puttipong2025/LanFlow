"use client";

import { useRef } from "react";
import dynamic from "next/dynamic";
import type { PaymentAllocationModalProps } from "./PaymentAllocationModal";

const PaymentAllocationModal = dynamic(
  () => import("./PaymentAllocationModal").then((module) => module.PaymentAllocationModal),
  { ssr: false },
);

export function LazyPaymentAllocationModal(props: PaymentAllocationModalProps) {
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  return <PaymentAllocationModal {...props} returnFocusElement={returnFocusRef.current} />;
}
