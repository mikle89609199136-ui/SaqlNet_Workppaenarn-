import React from "react";
import { useTranslation } from "react-i18next";
import { formatCallDuration, parseCallContent } from "../../../utils/call";
import { formatFileSize } from "../../../utils/formatFileSize";
import { Icon } from "../../ui/Icon";

export const CallMessageContent = ({ message }) => {
  const { t } = useTranslation();
  const duration = formatCallDuration(
    parseCallContent(message.content).duration,
  );
  return (
    <div className="message-call-content">
      <div className="message-call-icon" aria-hidden="true">
        <Icon name="phone" />
      </div>
      <div className="message-call-copy">
        <strong>{t("callEnded", "Звонок завершен")}</strong>
        {duration ? <span>{duration}</span> : null}
      </div>
    </div>
  );
};

export const MessageMedia = ({ message, onOpenImage }) => {
  const { t } = useTranslation();
  const {
    mediaUnavailable,
    mediaUnavailableReason,
    mediaUrl,
    mediaType,
    type,
    mediaEncryption,
  } = message;

  if (mediaUnavailable) {
    return (
      <div className="message-media-unavailable">
        {mediaUnavailableReason ??
          t(
            "mediaUnavailableUnencrypted",
            "Медиа недоступно: файл не зашифрован",
          )}
      </div>
    );
  }

  if (!mediaUrl) return null;

  const actualType = mediaType || type;

  if (["image", "gif", "sticker"].includes(actualType)) {
    return (
      <button
        aria-label={t("openImage", "Открыть изображение")}
        className="message-media-open"
        onClick={() => onOpenImage(mediaUrl)}
        type="button"
      >
        <img
          alt=""
          className={`message-media message-media-${actualType}`}
          src={mediaUrl}
        />
      </button>
    );
  }

  if (["video", "audio"].includes(actualType)) {
    return React.createElement(actualType, {
      className: "message-media",
      controls: true,
      src: mediaUrl,
    });
  }
  if (actualType === "voice") {
    return <audio className="message-media" controls src={mediaUrl} />;
  }

  if (actualType === "file") {
    return (
      <a className="message-media-file" download href={mediaUrl}>
        <Icon name="media-file" />
        <div className="message-media-file__content">
          <span className="message-media-file__title">
            {mediaEncryption.fileName}
          </span>
          <span className="message-media-file__size">
            {formatFileSize(mediaEncryption.sizeBytes)}
          </span>
        </div>
      </a>
    );
  }

  return null;
};
