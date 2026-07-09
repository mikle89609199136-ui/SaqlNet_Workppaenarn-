import { useCallback, useState } from 'react';

export function useToasts() {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((type, message, icon) => {
    const id = crypto.randomUUID?.() || String(Date.now() + Math.random());
    setToasts((items) => [...items, { icon, id, message, type }]);
    window.setTimeout(() => {
      setToasts((items) => items.filter((toast) => toast.id !== id));
    }, 3000);
  }, []);

  return { showToast, toasts };
}
