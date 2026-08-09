import { Loader2 } from "lucide-react";
import { ModalShell } from "@/components/shared/ModalShell";

export function RubberExportLoadingModal({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <ModalShell
      title={title}
      subtitle={message}
      onClose={() => undefined}
      closeDisabled
      size="compact"
    >
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center gap-3 py-6 text-center"
      >
        <Loader2
          aria-hidden="true"
          className="size-8 animate-spin text-leaf motion-reduce:animate-none"
        />
        <p className="text-pretty text-sm font-semibold text-ink/70">กรุณารอสักครู่</p>
      </div>
    </ModalShell>
  );
}
