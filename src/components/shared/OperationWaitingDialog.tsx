"use client";

import { LoaderCircle, X } from "lucide-react";

import { ModalShell } from "@/components/shared/ModalShell";

export function OperationWaitingDialog({
  open,
  title,
  description,
  progress,
  cancelLabel = "ยกเลิก",
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  progress?: string;
  cancelLabel?: string;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <ModalShell
      title={title}
      subtitle={description}
      onClose={onCancel}
      closeOnEscape
      renderInPortal
      nativeModal
      size="compact"
    >
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-md bg-field p-3 text-sm text-ink/70" aria-live="polite">
          <LoaderCircle className="animate-spin text-river" size={22} />
          <span className="text-pretty">{progress ?? description}</span>
        </div>
        <button
          autoFocus
          type="button"
          onClick={onCancel}
          className="focus-ring inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-actionSecondary px-4 text-sm font-semibold text-white hover:bg-actionSecondary/90"
        >
          <X size={17} /> {cancelLabel}
        </button>
      </div>
    </ModalShell>
  );
}
