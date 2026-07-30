const Check = ({ className }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      stroke="currentColor"
      className={`"opacity-90" ${className}`}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
};

export function MessageCheckbox({ isChecked, onChange, t, className }) {
  return (
    <button
      type="button"
      className={`size-6 flex items-center justify-center shrink-0 rounded-full
        border-2 transition-colors ${isChecked ? "border-accent bg-accent" : "border-zinc-500 bg-transparent"} ${className}`}
      onClick={onChange}
      aria-pressed={!!isChecked}
      aria-label={
        isChecked
          ? t("uncheckMessage", "Снять выбор")
          : t("checkMessage", "Выбрать сообщение")
      }
    >
      <Check
        className={`size-4 opacity-0 transition-opacity ${isChecked ? "fill-accent opacity-100" : ""}`}
      />
    </button>
  );
}
