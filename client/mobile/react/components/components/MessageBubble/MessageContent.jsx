import React from 'react';

export const MessageContentRenderer = React.memo(({ content }) => {
    if (!content) return null;

    const parts = [];
    const regex = /(#[\wа-яА-ЯёЁ]+)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(content)) !== null) {
        const textBefore = content.substring(lastIndex, match.index);
        if (textBefore) {
            parts.push(textBefore);
        }

        const hashtag = match[0];
        parts.push(
            <span
                key={match.index}
                className="hashtag-link"
                style={{
                    color: "var(--rd-accent, #ff2d8b)",
                    cursor: "pointer",
                    fontWeight: "bold"
                }}
                onClick={() => {
                    if (typeof window.handleUnifiedSearch === "function") {
                        window.handleUnifiedSearch(hashtag);
                    } else {
                        alert(`Поиск по хэштегу: ${hashtag}`);
                    }
                }}
            >
                {hashtag}
            </span>
        );
        lastIndex = regex.lastIndex;
    }

    const textAfter = content.substring(lastIndex);
    if (textAfter) {
        parts.push(textAfter);
    }

    return (
        <div className="message-content">
            {parts.length > 0 ? parts : content}
        </div>
    );
});

MessageContentRenderer.displayName = "MessageContentRenderer";
