import { useTranslation } from "react-i18next";

export const EmptyChatPlaceholder = () => {
  const {t} = useTranslation();
  return (
    <div className="empty-chat-placeholder">
      <div className="empty-chat-icon">💬</div>
      <h3>{t("selecteChat", "Выберите чат")}</h3>
      <p>{t("selectContactOrChatFromListForStartMesseging", "Выберите контакт или чат из списка слева, чтобы начать общение.")}</p>
    </div>
  );
};
