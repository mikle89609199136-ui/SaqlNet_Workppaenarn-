import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

const MAX_VISIBLE_SEGMENTS = 4;

export const PinnedMessages = ({ messages, t }) => {
  const navigate = useNavigate();
  const trackRef = useRef(null);

  const [currentPinnedMessageIndex, setCurrentPinnedMessageIndex] =
    useState(null);

  useEffect(() => {
    setCurrentPinnedMessageIndex(messages.length ? messages.length - 1 : null);
  }, [messages.length]);

  if (!messages.length) return null;

  const safeIndex = Math.min(
    currentPinnedMessageIndex ?? 0,
    messages.length - 1,
  );
  const currentMessage = messages[safeIndex]?.message;

  if (!currentMessage) return null;

  const totalSegments = messages.length;
  const visibleSegments = Math.min(totalSegments, MAX_VISIBLE_SEGMENTS);
  const isFilling = totalSegments <= MAX_VISIBLE_SEGMENTS;
  const maxWindowStart = Math.max(totalSegments - visibleSegments, 0);
  const windowStart = Math.min(
    Math.max(currentPinnedMessageIndex - visibleSegments + 1, 0),
    maxWindowStart,
  );

  const handleClick = () => {
    const targetId = currentMessage.id;

    requestAnimationFrame(() => {
      const el = document.getElementById(targetId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });

    if (currentPinnedMessageIndex === 0 && trackRef.current) {
      trackRef.current.style.transition = "none";
      requestAnimationFrame(() => {
        if (trackRef.current) trackRef.current.style.transition = "";
      });
    }

    setCurrentPinnedMessageIndex((prev) =>
      prev === 0 ? messages.length - 1 : prev - 1,
    );
  };

  return (
    <button
      className="pinned-messages"
      aria-label="Закреплённые сообщения"
      onClick={handleClick}
      type="button"
    >
      <div
        className="pinned-messages__progress"
        aria-hidden="true"
        style={{ "--pm-visible": visibleSegments }}
      >
        <div
          ref={trackRef}
          className={`pinned-messages__track ${isFilling ? "pinned-messages__track--fill" : ""}`}
          style={{ "--pm-window-start": windowStart }}
        >
          {messages.map((message, index) => (
            <span
              key={message.messageId}
              className={`pinned-messages__segment ${
                index === currentPinnedMessageIndex
                  ? "pinned-messages__segment--active"
                  : ""
              }`}
            />
          ))}
        </div>
      </div>

      <div className="pinned-messages__content">
        <span className="pinned-messages__title">
          {t("pinnedMessages", "Закреплённое сообщение")} #
          {currentPinnedMessageIndex + 1}
        </span>

        {(currentMessage.type === "text" || currentMessage.content) &&
          currentMessage.type !== "image" && (
            <p className="pinned-messages__text">{currentMessage.content}</p>
          )}

        {currentMessage.type === "image" && (
          <p className="pinned-messages__text">{currentMessage.mediaUrl}</p>
        )}

        {currentMessage.type === "file" && (
          <p className="pinned-messages__text">
            {currentMessage.mediaEncryption.fileName}
          </p>
        )}
      </div>
    </button>
  );
};
