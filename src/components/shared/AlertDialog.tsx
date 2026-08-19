"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

export function AlertDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "ยกเลิก",
  busy = false,
  onCancel,
  onConfirm,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-black/10 bg-white p-0 text-ink shadow-xl backdrop:bg-ink/50"
    >
      <div className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <h3 id={titleId} className="text-balance text-lg font-bold">
          {title}
        </h3>
        <p id={descriptionId} className="mt-2 text-pretty text-sm text-ink/70">
          {description}
        </p>
        {children}
        <div className="mt-5 flex justify-end gap-2">
          {cancelLabel && (
            <button
              autoFocus
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="focus-ring rounded-md border border-black/10 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {cancelLabel}
            </button>
          )}
          <button
            autoFocus={!cancelLabel}
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="focus-ring inline-flex items-center gap-2 rounded-md bg-clay px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
