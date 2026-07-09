(function initReactionController(global) {
  const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '🎉'];

  function createReactionController(options) {
    let reactionPickerEl = null;
    let reactionFullPickerEl = null;

    function toggleReactionFromMenu(emoji) {
      document.getElementById('messageContextMenu')?.classList.remove('active');
      const messageId = options.getCurrentMessageId();
      if (!options.isValidMessageId(messageId)) return;
      toggleReaction(messageId, emoji);
    }

    function openReactionPickerFromMenu() {
      const messageId = options.getCurrentMessageId();
      if (!options.isValidMessageId(messageId)) return;
      document.getElementById('messageContextMenu')?.classList.remove('active');
      setTimeout(() => showFullEmojiPicker(messageId), 50);
    }

    function updateContextMenuReactions(messageId) {
      const message = options.getMessage(messageId);
      if (!message?.reactions) return;

      const myReactions = new Set(
        message.reactions
          .filter((reaction) => reaction.myReaction)
          .map((reaction) => reaction.emoji)
      );

      document
        .querySelectorAll('.context-reaction-btn[onclick*="toggleReactionFromMenu"]')
        .forEach((button) => {
          const emoji = button.textContent.trim();
          button.classList.toggle('active-reaction', myReactions.has(emoji));
        });
    }

    function createReactionsElement(messageId, reactions) {
      const element = document.createElement('div');
      element.className = 'message-reactions';
      element.dataset.messageId = messageId;

      reactions.forEach((reaction) => {
        const badge = document.createElement('div');
        badge.className = `reaction-badge${reaction.myReaction ? ' my-reaction' : ''}`;
        const emojiSpan = document.createElement('span');
        emojiSpan.textContent = reaction.emoji;
        const countSpan = document.createElement('span');
        countSpan.className = 'reaction-count';
        countSpan.textContent = reaction.count;
        badge.appendChild(emojiSpan);
        badge.appendChild(countSpan);
        badge.onclick = (event) => {
          event.stopPropagation();
          toggleReaction(messageId, reaction.emoji);
        };
        element.appendChild(badge);
      });

      return element;
    }

    function updateMessageReactions(messageId, reactions) {
      const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
      if (!messageElement) return;

      messageElement.querySelector('.message-reactions')?.remove();

      if (!reactions?.length) return;

      const normalizedReactions = reactions.map((reaction) => ({
        emoji: reaction.emoji,
        count: parseInt(reaction.count, 10),
        myReaction: reaction.my_reaction || reaction.myReaction,
      }));
      const element = createReactionsElement(messageId, normalizedReactions);
      const timeElement = messageElement.querySelector('.msg-time');

      if (timeElement) {
        messageElement.insertBefore(element, timeElement);
      } else {
        messageElement.appendChild(element);
      }
    }

    function showReactionPicker(event, messageId) {
      event.stopPropagation();
      closeReactionPicker();

      reactionPickerEl = document.createElement('div');
      reactionPickerEl.className = 'reaction-picker';

      QUICK_REACTIONS.forEach((emoji) => {
        const button = document.createElement('div');
        button.className = 'reaction-picker-emoji';
        button.textContent = emoji;
        button.onclick = (clickEvent) => {
          clickEvent.stopPropagation();
          toggleReaction(messageId, emoji);
          closeReactionPicker();
        };
        reactionPickerEl.appendChild(button);
      });

      const moreButton = document.createElement('div');
      moreButton.className = 'reaction-picker-more';
      moreButton.textContent = '＋';
      moreButton.onclick = (clickEvent) => {
        clickEvent.stopPropagation();
        showFullEmojiPicker(messageId);
      };
      reactionPickerEl.appendChild(moreButton);

      document.body.appendChild(reactionPickerEl);
      positionQuickPicker(messageId, reactionPickerEl);
    }

    function showFullEmojiPicker(messageId) {
      closeReactionPicker();

      reactionFullPickerEl = document.createElement('div');
      reactionFullPickerEl.className = 'reaction-full-picker';

      const grid = document.createElement('div');
      grid.className = 'reaction-full-picker-grid';
      getAvailableEmojis().slice(0, 200).forEach((emoji) => {
        const button = document.createElement('div');
        button.className = 'reaction-full-picker-emoji';
        button.textContent = emoji;
        button.onclick = (event) => {
          event.stopPropagation();
          toggleReaction(messageId, emoji);
          closeFullEmojiPicker();
        };
        grid.appendChild(button);
      });

      reactionFullPickerEl.appendChild(grid);
      document.body.appendChild(reactionFullPickerEl);
      reactionFullPickerEl.style.left = `${Math.max(8, (window.innerWidth - 300) / 2)}px`;
      reactionFullPickerEl.style.top = `${Math.max(8, (window.innerHeight - 280) / 2)}px`;
    }

    function closeReactionPicker() {
      reactionPickerEl?.remove();
      reactionPickerEl = null;
    }

    function closeFullEmojiPicker() {
      reactionFullPickerEl?.remove();
      reactionFullPickerEl = null;
    }

    async function toggleReaction(messageId, emoji) {
      if (!options.isValidMessageId(messageId)) return;

      try {
        const response = await fetch(`/api/v2/messages/${messageId}/reactions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${options.getToken()}`,
          },
          body: JSON.stringify({ emoji }),
        });
        const data = await response.json();

        if (data.reactions !== undefined) {
          updateMessageReactions(messageId, data.reactions);
        }
      } catch (error) {
        console.error('Reaction error:', error);
      }
    }

    function handleDocumentClick(event) {
      if (reactionPickerEl && !reactionPickerEl.contains(event.target)) {
        closeReactionPicker();
      }
      if (reactionFullPickerEl && !reactionFullPickerEl.contains(event.target)) {
        closeFullEmojiPicker();
      }
    }

    document.addEventListener('click', handleDocumentClick);

    return {
      closeFullEmojiPicker,
      closeReactionPicker,
      showFullEmojiPicker,
      showReactionPicker,
      toggleReaction,
      toggleReactionFromMenu,
      openReactionPickerFromMenu,
      updateContextMenuReactions,
      updateMessageReactions,
    };
  }

  function getAvailableEmojis() {
    const categories = ['smileys', 'animals', 'food', 'activities', 'travel', 'objects', 'symbols'];
    const emojis = categories.flatMap((category) => global.EmojiData?.[category] || []);
    return emojis.length ? emojis : QUICK_REACTIONS;
  }

  function positionQuickPicker(messageId, pickerElement) {
    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!messageElement) return;

    const rect = messageElement.getBoundingClientRect();
    const pickerWidth = 320;
    let left = rect.left;

    if (left + pickerWidth > window.innerWidth) left = window.innerWidth - pickerWidth - 8;
    if (left < 8) left = 8;

    pickerElement.style.left = `${left}px`;
    pickerElement.style.top = `${Math.max(8, rect.top - 60)}px`;
  }

  global.CraneReactionController = {
    create: createReactionController,
  };
})(window);
