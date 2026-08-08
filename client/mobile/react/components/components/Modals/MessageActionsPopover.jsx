import { useTranslation } from "react-i18next";
import { useMessageActions } from "../../../hooks/useMessageActions";
import { useChatStore } from "../../../store/chat";
import { Icon } from "../../ui/Icon.tsx";

const REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

export const MessageActionsPopover = (props) => {
  const { message, onSelection, currentUserId } = props;
  const { t } = useTranslation();
  const actions = useMessageActions(props); // Передаем props целиком, чтобы не деструктурировать дважды
  const { selectedMessages, pinnedMessages, selectionMode, actionMenu } =
    useChatStore();

  const mine = message.senderId === currentUserId;
  const isPinned = pinnedMessages.some((p) => p.messageId === message.id);
  const isSelected = selectedMessages.some((m) => m.id === message.id);

  const buttons = [
    {
      show: !selectionMode,
      icon: "reply",
      key: "reply",
      def: "Ответить",
      action: () => actions.startReply(message),
    },
    {
      show: true,
      icon: "copy",
      key: "copy",
      def: "Скопировать",
      action: () => actions.handleCopyMessage(message),
    },
    {
      show: !mine && !selectionMode,
      icon: "language",
      key: "translate",
      def: "Перевести",
      action: () => actions.handleTranslateMessage(message),
    },
    {
      show: mine && !selectionMode,
      icon: "edit",
      key: "edit",
      def: "Изменить",
      action: () => actions.startEdit(message),
    },
    {
      show: !isPinned && !selectionMode,
      icon: "pin",
      key: "pin",
      def: "Закрепить",
      action: () => actions.handlePinMessage(message),
    },
    {
      show: isPinned && !selectionMode,
      icon: "pin",
      key: "unpin",
      def: "Открепить",
      action: () => actions.handleUnpinMessage(message),
    },
    {
      show: true,
      icon: "forward",
      key: "forward",
      def: "Переслать",
      action: () => actions.handleForward(message),
    },
    {
      show: mine,
      icon: "trash",
      key: "delete",
      def: "Удалить",
      action: () => actions.handleDelete(message),
      className: "is-danger",
    },
  ];

  return (
    <div
      className="message-actions-popover"
      onClick={(e) => e.stopPropagation()}
      style={{ left: actionMenu?.x, top: actionMenu?.y }}
    >
      {/* Реакции */}
      <div className="message-reaction-actions">
        {REACTIONS.map((emoji) => (
          <button
            key={emoji}
            onClick={() =>
              actions.runMessageAction(() =>
                actions.handleReact(message, emoji),
              )
            }
            type="button"
            className="shrink-0"
          >
            {emoji}
          </button>
        ))}
      </div>

      {/* Действия с текстом */}
      <div className="message-text-actions">
        {buttons
          .filter((b) => b.show)
          .map((b) => (
            <button
              key={b.key}
              className={b.className}
              onClick={() => actions.runMessageAction(b.action)}
              type="button"
            >
              <Icon name={b.icon} />
              <span>{t(b.key, b.def)}</span>
            </button>
          ))}

        {/* Объединили кнопку выбора в одну строку без дублирования тегов */}
        <button
          onClick={() =>
            actions.runMessageAction(() =>
              selectionMode
                ? onSelection(message)
                : actions.startSelection(message),
            )
          }
          type="button"
        >
          <Icon name="check-circle" className="fill-transparent" />
          <span>
            {isSelected
              ? t("uncheckMessage", "Снять выбор")
              : t("checkMessage", "Выбрать")}
          </span>
        </button>
      </div>
    </div>
  );
};
