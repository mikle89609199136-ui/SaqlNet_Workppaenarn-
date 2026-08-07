import { memo, useMemo } from "react";
import { STORAGE_KEYS } from "../../../consts/storageKeys";
import { useCall } from "../../../hooks/useCall";
import { useLocalStorage } from "../../../hooks/useLocalStorage";
import { useProfileEdit } from "../../../hooks/useProfileEdit";
import { getChatSubtitle } from "../../../utils/getChatSubtitle";
import { Icon } from "../../ui/Icon";
import { Identicon } from "../../ui/Identicon";
import { useTranslation } from "react-i18next";

export const UserProfilePanel = memo(
  ({ profileState, onClose, stopPropagation = false }) => {
    const { t } = useTranslation();
    const { initiateCall } = useCall();
    const [currentUser] = useLocalStorage(STORAGE_KEYS.USER, null);

    const baseUser = profileState.user;

    const displayName = useMemo(() => {
      return (
        [baseUser?.firstName, baseUser?.lastName].filter(Boolean).join(" ") ||
        baseUser?.username ||
        profileState.chat?.name ||
        profileState.chat?.title ||
        t("user", "Пользователь")
      );
    }, [baseUser, profileState.chat, t]);

    const edit = useProfileEdit(baseUser, displayName, t);
    const profileUser = edit.editableUser || baseUser;

    const isOwnProfile = useMemo(() => {
      const currentUserId = currentUser?.id;
      return !!(
        profileUser?.id &&
        currentUserId &&
        profileUser.id === currentUserId
      );
    }, [profileUser?.id]);

    const sharedMedia = useMemo(() => {
      return profileState.messages.filter(
        (m) =>
          m.mediaUrl &&
          ["image", "gif", "sticker", "video"].includes(m.mediaType || m.type),
      );
    }, [profileState.messages]);

    const username = profileUser?.username ? `@${profileUser.username}` : "";
    const status = profileUser?.isBot
      ? t("bot", "бот")
      : getChatSubtitle(profileState.chat, null, t);
    const avatarUrl =
      profileUser?.avatarUrl || profileState.chat?.avatarUrl || "";
    const canCall = !!profileState.chat?.id;

    const copyText = (val) =>
      val && navigator?.clipboard?.writeText(val).catch(() => {});

    const startCall = (type) => () => {
      if (canCall && profileState.chat) {
        initiateCall(
          profileState.chat.id,
          profileState.chat.type,
          displayName,
          type,
          profileState.chat.peerId,
        );
      }
    };

    const actionButtons = [
      {
        handleClick: onClose,
        disabled: false,
        name: "message-circle",
        title: t("chat", "Чат"),
      },
      {
        handleClick: startCall("audio"),
        disabled: !canCall,
        name: "phone",
        title: t("call", "Звонок"),
      },
      {
        handleClick: startCall("video"),
        disabled: !canCall,
        name: "video",
        title: t("videoCall", "Видеозвонок"),
      },
    ];

    return (
      <section
        aria-label={t("profile", "Профиль")}
        className="user-profile-card"
        onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
      >
        <header className="user-profile-header">
          <button className="user-profile-back" onClick={onClose} type="button">
            <span aria-hidden="true">‹</span>
            {t("back", "Назад")}
          </button>
          <strong>{t("information", "Информация")}</strong>
          {isOwnProfile ? (
            // ИСПРАВЛЕНО: Прямой вызов функций из хука edit
            <button
              className="user-profile-edit"
              onClick={
                edit.isEditing ? () => edit.setIsEditing(false) : edit.startEdit
              }
              type="button"
            >
              {edit.isEditing ? t("cancel", "Отмена") : t("editShort", "Изм.")}
            </button>
          ) : (
            <span />
          )}
        </header>

        {profileState.isLoading ? (
          <div className="user-profile-state">
            {t("loading", "Загрузка...")}
          </div>
        ) : profileState.error ? (
          <div className="user-profile-state is-error">
            {profileState.error}
          </div>
        ) : (
          <div className="user-profile-scroll">
            <div className="user-profile-hero">
              <div className="user-profile-avatar">
                {avatarUrl ? (
                  <img alt="" src={avatarUrl} />
                ) : (
                  <Identicon
                    userId={
                      profileUser?.id ||
                      profileState.chat?.peerId ||
                      displayName
                    }
                    size={112}
                  />
                )}
              </div>
              <h2>{displayName}</h2>
              <p
                className={`user-profile-status ${profileState.chat?.peerIsOnline ? "is-online" : ""}`}
              >
                {status}
              </p>
            </div>

            <div className="user-profile-actions">
              {actionButtons.map((button) => (
                <button
                  key={button.name}
                  disabled={button.disabled}
                  onClick={button.handleClick}
                  type="button"
                >
                  <Icon name={button.name} />
                  {button.title}
                </button>
              ))}
            </div>

            {edit.isEditing ? (
              // ИСПРАВЛЕНО: Вызов edit.saveProfileEdit вместо saveProfileEdit
              <form
                className="user-profile-edit-form"
                onSubmit={edit.saveProfileEdit}
              >
                {["firstName", "bio"].map((field) => {
                  const isBio = field === "bio";
                  return (
                    <label key={field}>
                      <span>
                        {t(isBio ? "bio" : "name", isBio ? "О себе" : "Имя")}
                      </span>
                      {isBio ? (
                        <textarea
                          onChange={(e) =>
                            edit.setEditDraft((draft) => ({
                              ...draft,
                              [field]: e.target.value,
                            }))
                          }
                          rows={4}
                          value={edit.editDraft[field]}
                        />
                      ) : (
                        <input
                          onChange={(e) =>
                            edit.setEditDraft((draft) => ({
                              ...draft,
                              [field]: e.target.value,
                            }))
                          }
                          type="text"
                          value={edit.editDraft[field]}
                        />
                      )}
                    </label>
                  );
                })}
                {edit.editError && (
                  <p className="error-message">{edit.editError}</p>
                )}
                <button
                  disabled={edit.isSaving || !edit.editDraft.firstName.trim()}
                  type="submit"
                >
                  {edit.isSaving
                    ? t("saving", "Сохранение...")
                    : t("save", "Сохранить")}
                </button>
              </form>
            ) : (
              <div className="user-profile-info-card">
                {username && (
                  <button
                    className="user-profile-copy-row"
                    onClick={() => copyText(username)}
                    type="button"
                  >
                    <span>{t("username", "Имя пользователя")}</span>
                    <strong>{username}</strong>
                    <Icon name="copy" />
                  </button>
                )}
                <div className="user-profile-info-row">
                  <span>{t("bio", "О себе")}</span>
                  <strong>
                    {profileUser?.bio ||
                      t("profileBioEmpty", "Информация не указана")}
                  </strong>
                </div>
              </div>
            )}

            <div className="user-profile-tabs">
              <button className="active" type="button">
                {t("media", "Медиа")}
              </button>
            </div>

            {/* ИСПРАВЛЕНО: Полностью восстановлена закрывающая логика медиа-блока и тегов */}
            {sharedMedia.length ? (
              <div className="user-profile-media-grid">
                {sharedMedia.map(({ mediaType, type, mediaUrl, id }) => {
                  const isVideo = (mediaType || type) === "video";
                  return (
                    <a
                      aria-label={t("openMedia", "Открыть медиа")}
                      href={mediaUrl}
                      key={id}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {isVideo ? (
                        <video muted preload="metadata" src={mediaUrl} />
                      ) : (
                        <img alt="" loading="lazy" src={mediaUrl} />
                      )}
                      {isVideo && <span aria-hidden="true">▶</span>}
                    </a>
                  );
                })}
              </div>
            ) : (
              <div className="user-profile-empty-media">
                {t("profileMediaEmpty", "Медиафайлы отсутствуют")}
              </div>
            )}
          </div>
        )}
      </section>
    );
  },
);
