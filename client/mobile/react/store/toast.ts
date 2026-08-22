import { create } from "zustand";

type TToastType = "success" | "error" | "info" | "warning";

interface InitialState {
	toasts: {
		id: string;
		message: string;
		type: TToastType;
		icon: string;
	}[];
	showToast: (type: TToastType, message: string, icon: string) => void;
}

export const useToastStore = create<InitialState>((set) => ({
	toasts: [],

	showToast: (type, message, icon) => {
		const id = crypto.randomUUID();

		set((state) => ({
			toasts: [...state.toasts, { id, type, message, icon }],
		}));

		setTimeout(() => {
			set((state) => ({
				toasts: state.toasts.filter((t) => t.id !== id),
			}));
		}, 3000);
	},
}));
