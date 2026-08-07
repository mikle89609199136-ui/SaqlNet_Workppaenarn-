import { memo } from "react";
import { useMessageLongPress } from "../../../hooks/useMessageLongPress";
import { useChatStore } from "../../../store/chat";
import { formatMessageTime, hasMessageMedia } from "../../../utils/message";
import { MessageCheckbox } from "../../ui/MessageCheckbox";
import { MessageContentRenderer } from "./MessageContent";
import { CallMessageContent, MessageMedia } from "./MessageMedia";
import { useTranslation } from "react-i18next";

export const MessageBubble = memo(
  ({ currentUserId, message, translations, onOpenImage, onSelection }) => {
    const {
      actionMenu,
      setActionMenu,
      selectedMessages,
      messages,
      selectionMode,
    } = useChatStore();
    const { t } = useTranslation();

    const mine = message.senderId === currentUserId;
    const isActionTarget = actionMenu?.messageId === message.id;

    // Оптимизация: some() вместо find() для булевой проверки
    const isSelected = selectedMessages.some(({ id }) => id === message.id);

    // Подключаем наш кастомный хук и деструктурируем все события сразу
    const longPressHandlers = useMessageLongPress(
      message.id,
      selectionMode,
      onSelection,
      actionMenu,
      setActionMenu,
      message,
    );

    // Вычисляем данные ответов
    const repliedMessage = message.replyTo
      ? messages.find(({ id }) => id === message.replyTo)
      : null;
    const replyText =
      repliedMessage?.content?.trim() || message.replyToContent?.trim() || "";
    const replyImage =
      repliedMessage?.mediaUrl || message.replyToMediaUrl || null;

    return (
      <article
        id={message.id}
        className={`flex justify-between gap-x-2 ${mine ? "justify-end" : ""}`}
        {...longPressHandlers} // Передаем все хэндлеры одной строкой через спред-оператор
      >
        <div
          className={`message-bubble ${mine ? "is-mine" : ""} ${hasMessageMedia(message) ? "has-media" : ""} ${isActionTarget ? "is-action-target" : ""} ${isSelected ? "is-selected bg-accent" : ""}`}
        >
          {!mine && message.senderStatusEmoji && (
            <div className="message-sender">
              <span className="sender-status-emoji" style={{ marginLeft: 6 }}>
                {message.senderStatusEmoji}
              </span>
            </div>
          )}

          {(replyText || replyImage) && (
            <a
              href={`#${message.replyTo}`}
              className="message-reply-preview"
              aria-label={t("goToMessage", "Перейти к сообщению")}
            >
              {replyImage && (
                <img
                  src={replyImage}
                  alt=""
                  className="message-reply-preview-image"
                />
              )}
              {replyText && <span>{replyText}</span>}
            </a>
          )}

          <MessageMedia message={message} onOpenImage={onOpenImage} />

          {message.type === "call" ? (
            <CallMessageContent message={message} />
          ) : (
            <MessageContentRenderer
              content={translations[message.id] || message.content}
            />
          )}

          {message.reactions?.length > 0 && (
            <div className="message-reactions">
              {message.reactions.map((reaction) => (
                <span
                  className={reaction.myReaction ? "is-mine" : ""}
                  key={reaction.emoji}
                >
                  {reaction.emoji} {reaction.count}
                </span>
              ))}
            </div>
          )}

          <div className="message-meta">
            {message.isEdited && <span>{t("edited", "изменено")}</span>}
            <time>
              {formatMessageTime(message.timestamp || message.createdAt)}
            </time>
          </div>
        </div>
        {selectionMode && (
          <MessageCheckbox
            isChecked={isSelected}
            className="grow-0 self-end"
          />
        )}
      </article>
    );
  },
);
