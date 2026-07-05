export function ModalShell({
  title,
  subtitle,
  onClose,
  size = "normal",
  children
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  size?: "normal" | "wide";
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-3 sm:p-6">
      <div className={`mt-4 w-full rounded-md bg-white shadow-2xl ${size === "wide" ? "max-w-6xl" : "max-w-4xl"}`}>
        <div className="flex items-start justify-between gap-3 border-b border-black/10 px-4 py-3">
          <div>
            <h2 className="text-lg font-bold text-ink">{title}</h2>
            {subtitle && <p className="text-sm text-ink/60">{subtitle}</p>}
          </div>
          <button
            type="button"
            aria-label="ปิด"
            onClick={onClose}
            className="focus-ring grid h-9 w-9 place-items-center rounded-md bg-field text-ink"
          >
            ×
          </button>
        </div>
        <div className="max-h-[calc(100vh-120px)] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
