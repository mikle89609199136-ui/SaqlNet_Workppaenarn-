export function ToastStack({ toasts }) {
  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map((toast) => (
        <div className={`toast ${toast.type === 'success' ? 'success' : ''}`} key={toast.id}>
          <span>{toast.icon}</span>
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
