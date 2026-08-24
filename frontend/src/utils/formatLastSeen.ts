import type { TFunction } from "i18next";

export const formatLastSeen = (value: string | Date, t: TFunction): string => {
	if (value === "recently") return t("lastSeenRecently", "был(а) недавно");

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return t("lastSeenRecently", "был(а) недавно");

	// Создаем дату для текущего дня БЕЗ привязки к глобальному синглтону (для точности в будущем)
	const today = new Date();
	const sameDay = date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();

	const formatted = new Intl.DateTimeFormat(
		undefined,
		sameDay
			? { hour: "2-digit", minute: "2-digit" }
			: {
					day: "2-digit",
					month: "2-digit",
					hour: "2-digit",
					minute: "2-digit",
				},
	).format(date);

	return t("lastSeenAt", "был(а) {time}", { time: formatted }).replace("{time}", formatted);
};
