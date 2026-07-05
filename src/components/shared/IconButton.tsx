export function IconButton({
  label,
  tone,
  onClick,
  children
}: {
  label: string;
  tone: "amber" | "clay";
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`focus-ring grid h-9 w-9 place-items-center rounded-md text-white ${
        tone === "amber" ? "bg-amber" : "bg-clay"
      }`}
    >
      {children}
    </button>
  );
}
