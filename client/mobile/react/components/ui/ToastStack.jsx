import { useToasts } from "../../hooks/useToasts";
import { cn } from "../../utils/cn";

export function ToastStack() {
  const { toasts } = useToasts();

  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map((toast) => (
        <div
          className={cn("toast", toast.type === "success" && "success")}
          key={toast.id}
        >
          <span>{toast.icon}</span>
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
