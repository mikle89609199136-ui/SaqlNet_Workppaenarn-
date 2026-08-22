import type { ILastMessageDto } from "@/types";
import type { TFunction } from "i18next";

export function getLastMessageText(lastMessage: ILastMessageDto | undefined, t: TFunction) {
	if (!lastMessage) return t('noMessages', 'Нет сообщений');

	if (lastMessage.content) return lastMessage.content;

	if (lastMessage.type === "image") return t("lastMessage.image", "Фотография");
	if (lastMessage.type === "audio") return t("lastMessage.audio", "Аудио");
	if (lastMessage.type === "call") return t("lastMessage.call", "Звонок");
	if (lastMessage.type === "file") return t("lastMessage.file", "Файл");
	if (lastMessage.type === "gif") return t("lastMessage.gif", "Гиф");
	if (lastMessage.type === "sticker") return t("lastMessage.sticker", "Стикер");
	if (lastMessage.type === "video") return t("lastMessage.video", "Видео");
	if (lastMessage.type === "voice") return t("lastMessage.voice", "Голосовое сообщение");
}