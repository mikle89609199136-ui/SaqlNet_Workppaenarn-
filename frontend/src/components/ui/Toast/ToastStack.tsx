import { useToastStore } from '@/store/toast';
import { Toast } from './Toast';

/* Живой области на контейнере нет намеренно: роль объявляет каждое
   уведомление само — alert у ошибок, status у остальных. Вложенные живые
   области спорят между собой, и диктор объявляет то одно, то другое. */
export function ToastStack() {
  const toasts = useToastStore((state) => state.toasts);
  const hideToast = useToastStore((state) => state.hideToast);

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-[calc(20px+env(safe-area-inset-bottom,0px))] z-[99999] flex flex-col gap-1.5 md:left-auto md:w-90">
      {toasts.map((toast) => (
        <Toast key={toast.id} onHide={hideToast} toast={toast} />
      ))}
    </div>
  );
}
