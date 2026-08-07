import { useToastStore } from "../store/toast";

export const useToasts = () => {
  const toasts = useToastStore((state) => state.toasts);
  const showToast = useToastStore((state) => state.showToast);

  return { toasts, showToast };
};
