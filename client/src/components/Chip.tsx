interface ChipProps {
  label: string;
  selected: boolean;
  onClick: () => void;
}

export function Chip({ label, selected, onClick }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "px-4 py-2 rounded-full border text-sm font-medium transition-all duration-150 cursor-pointer",
        selected
          ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
          : "border-[var(--border)] text-[var(--text-soft)] hover:border-[var(--accent)] hover:text-[var(--text)]",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
