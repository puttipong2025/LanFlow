"use client";

import { useCallback, useState } from "react";
import { ModalShell } from "@/components/shared/ModalShell";

type InputDialogOptions = {
  title: string;
  label: string;
  initialValue?: string;
  inputType?: "text" | "number" | "month" | "date";
  multiline?: boolean;
  required?: boolean;
  min?: number | string;
  max?: number | string;
  step?: number;
  submitLabel?: string;
};

type PendingInputDialog = InputDialogOptions & {
  resolve: (value: string | null) => void;
};

export function useInputDialog() {
  const [dialog, setDialog] = useState<PendingInputDialog | null>(null);
  const [value, setValue] = useState("");

  const requestInput = useCallback((options: InputDialogOptions) => {
    setValue(options.initialValue ?? "");
    return new Promise<string | null>((resolve) => {
      setDialog({ ...options, resolve });
    });
  }, []);

  function close() {
    dialog?.resolve(null);
    setDialog(null);
  }

  function submit() {
    if (!dialog) return;
    if (dialog.required && !value.trim()) return;
    dialog.resolve(value);
    setDialog(null);
  }

  const inputDialog = dialog ? (
    <ModalShell
      title={dialog.title}
      onClose={close}
      nativeModal
      renderInPortal
      closeOnEscape
      size="compact"
    >
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="block text-sm font-semibold text-ink" htmlFor="input-dialog-value">
          {dialog.label}
        </label>
        {dialog.multiline ? (
          <textarea
            id="input-dialog-value"
            autoFocus
            required={dialog.required}
            rows={3}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="mt-2 w-full rounded-md border border-black/15 px-3 py-2"
          />
        ) : (
          <input
            id="input-dialog-value"
            autoFocus
            required={dialog.required}
            type={dialog.inputType ?? "text"}
            min={dialog.min}
            max={dialog.max}
            step={dialog.step}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="mt-2 w-full rounded-md border border-black/15 px-3 py-2"
          />
        )}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={close}
            className="rounded-md bg-actionSecondary px-4 py-2 text-sm font-bold text-white hover:bg-actionSecondary/90"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            disabled={dialog.required && !value.trim()}
            className="rounded-md bg-success px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {dialog.submitLabel ?? "ยืนยัน"}
          </button>
        </div>
      </form>
    </ModalShell>
  ) : null;

  return { requestInput, inputDialog };
}
