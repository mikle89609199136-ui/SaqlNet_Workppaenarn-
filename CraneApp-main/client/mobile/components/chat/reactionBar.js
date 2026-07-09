/**
 * CraneApp Reaction Bar Component
 * Emoji reaction picker for messages
 */

class ReactionBar {
    constructor(options = {}) {
        this.options = {
            messageId: options.messageId || null,
            existingReactions: options.existingReactions || [],
            onReact: options.onReact || null,
            onRemove: options.onRemove || null,
            position: options.position || 'top', // top, bottom
            className: options.className || '',
            ...options
        };
        
        this.element = null;
        this.selectedEmoji = null;
        this.render();
    }

    render() {
        this.element = document.createElement('div');
        this.element.className = this.getClasses();
        
        // Quick reactions
        const quickReactions = document.createElement('div');
        quickReactions.className = 'reaction-quick';
        
        const quickEmojis = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👎'];
        
        quickEmojis.forEach(emoji => {
            const btn = this.createReactionButton(emoji, false);
            quickReactions.appendChild(btn);
        });
        
        this.element.appendChild(quickReactions);
        
        // More reactions button
        const moreBtn = document.createElement('button');
        moreBtn.className = 'reaction-more-btn';
        moreBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="1"></circle>
                <circle cx="19" cy="12" r="1"></circle>
                <circle cx="5" cy="12" r="1"></circle>
            </svg>
        `;
        moreBtn.addEventListener('click', () => this.showEmojiPicker());
        this.element.appendChild(moreBtn);
        
        return this.element;
    }

    createReactionButton(emoji, isFromPicker = false) {
        const btn = document.createElement('button');
        btn.className = 'reaction-btn';
        
        // Check if user already reacted with this emoji
        const existingReaction = this.options.existingReactions.find(
            r => r.emoji === emoji && r.reacted
        );
        
        if (existingReaction) {
            btn.classList.add('reacted');
        }
        
        btn.textContent = emoji;
        
        btn.addEventListener('click', () => {
            if (existingReaction) {
                // Remove reaction
                this.options.onRemove?.(this.options.messageId, emoji);
            } else {
                // Add reaction
                this.options.onReact?.(this.options.messageId, emoji);
            }
            
            // Dispatch custom event
            window.dispatchEvent(new CustomEvent('reaction-selected', {
                detail: {
                    messageId: this.options.messageId,
                    emoji,
                    action: existingReaction ? 'remove' : 'add'
                }
            }));
        });
        
        return btn;
    }

    showEmojiPicker() {
        // Create emoji picker popup
        const picker = document.createElement('div');
        picker.className = 'emoji-picker-popup';
        
        // Emoji categories
        const categories = {
            'Smileys': ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐'],
            'Gestures': ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐', '🖖', '👋', '🤝', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🙏', '💪', '🦾'],
            'Hearts': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️'],
            'Objects': ['🔥', '✨', '💫', '🎉', '🎊', '🎁', '🏆', '⚽', '🏀', '🎮', '🎯', '🎨', '🎬', '📷', '📱', '💻', '💡', '📌', '📎', '✏️', '📝', '📖', '📚', '🔔', '🔑', '🔒', '💎', '💰', '💵'],
            'Nature': ['🌸', '🌺', '🌻', '🌼', '🌷', '🌹', '💐', '🌾', '🍀', '🌲', '🌳', '🌴', '🌵', '🍃', '🍂', '🍁', '🌈', '⭐', '🌟', '✨', '🌙', '☀️', '🌤', '⛅', '🌧', '❄️', '🌊', '🔥', '💧', '🌸']
        };
        
        // Category tabs
        const tabs = document.createElement('div');
        tabs.className = 'emoji-picker-tabs';
        
        const tabIcons = {
            'Smileys': '😀',
            'Gestures': '👍',
            'Hearts': '❤️',
            'Objects': '🎉',
            'Nature': '🌸'
        };
        
        Object.keys(categories).forEach((category, index) => {
            const tab = document.createElement('button');
            tab.className = `emoji-tab ${index === 0 ? 'active' : ''}`;
            tab.textContent = tabIcons[category];
            tab.dataset.category = category;
            
            tab.addEventListener('click', () => {
                tabs.querySelectorAll('.emoji-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.showCategory(picker, category, categories[category]);
            });
            
            tabs.appendChild(tab);
        });
        
        picker.appendChild(tabs);
        
        // Emoji grid
        const grid = document.createElement('div');
        grid.className = 'emoji-picker-grid';
        grid.id = 'emoji-grid';
        picker.appendChild(grid);
        
        // Show first category
        this.showCategory(picker, 'Smileys', categories['Smileys']);
        
        // Position popup
        document.body.appendChild(picker);
        
        const rect = this.element.getBoundingClientRect();
        picker.style.position = 'fixed';
        
        if (this.options.position === 'top') {
            picker.style.bottom = `${window.innerHeight - rect.top + 8}px`;
        } else {
            picker.style.top = `${rect.bottom + 8}px`;
        }
        
        picker.style.left = `${Math.min(rect.left, window.innerWidth - 300)}px`;
        
        // Close on click outside
        const closePicker = (e) => {
            if (!picker.contains(e.target) && !this.element.contains(e.target)) {
                picker.remove();
                document.removeEventListener('click', closePicker);
            }
        };
        
        setTimeout(() => document.addEventListener('click', closePicker), 100);
    }

    showCategory(picker, category, emojis) {
        const grid = picker.querySelector('#emoji-grid');
        grid.innerHTML = '';
        
        emojis.forEach(emoji => {
            const btn = document.createElement('button');
            btn.className = 'emoji-picker-btn';
            btn.textContent = emoji;
            
            btn.addEventListener('click', () => {
                this.options.onReact?.(this.options.messageId, emoji);
                picker.remove();
                
                window.dispatchEvent(new CustomEvent('reaction-selected', {
                    detail: {
                        messageId: this.options.messageId,
                        emoji,
                        action: 'add'
                    }
                }));
            });
            
            grid.appendChild(btn);
        });
    }

    getClasses() {
        const classes = ['reaction-bar', `reaction-bar-${this.options.position}`];
        
        if (this.options.className) {
            classes.push(this.options.className);
        }
        
        return classes.join(' ');
    }

    updateReactions(reactions) {
        this.options.existingReactions = reactions;
        // Re-render buttons
        const buttons = this.element?.querySelectorAll('.reaction-btn');
        buttons?.forEach(btn => {
            const emoji = btn.textContent;
            const existingReaction = reactions.find(r => r.emoji === emoji && r.reacted);
            btn.classList.toggle('reacted', !!existingReaction);
        });
    }

    getElement() {
        return this.element;
    }

    destroy() {
        if (this.element) {
            this.element.remove();
            this.element = null;
        }
    }
}

// CSS for ReactionBar
const reactionBarStyles = `
.reaction-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 12px;
    background: var(--color-background-secondary, #121212);
    border-radius: 24px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
}

.reaction-quick {
    display: flex;
    gap: 2px;
}

.reaction-btn {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 50%;
    font-size: 22px;
    cursor: pointer;
    transition: all 150ms;
}

.reaction-btn:hover {
    transform: scale(1.15);
    background: var(--color-background-tertiary, #2D2D2D);
}

.reaction-btn:active {
    transform: scale(0.95);
}

.reaction-btn.reacted {
    background: rgba(233, 30, 140, 0.2);
    border: 2px solid #E91E8C;
}

.reaction-more-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 50%;
    color: var(--color-text-secondary, #B3B3B3);
    cursor: pointer;
    transition: all 150ms;
}

.reaction-more-btn:hover {
    background: var(--color-background-tertiary, #2D2D2D);
    color: var(--color-text-primary, #FFFFFF);
}

/* Emoji Picker Popup */
.emoji-picker-popup {
    width: 280px;
    background: var(--color-background-secondary, #121212);
    border-radius: 16px;
    padding: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    z-index: 1000;
    animation: scaleIn 150ms ease-out;
}

@keyframes scaleIn {
    from { transform: scale(0.95); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
}

.emoji-picker-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--color-border-default, #3D3D3D);
}

.emoji-tab {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 8px;
    font-size: 18px;
    cursor: pointer;
    transition: all 150ms;
}

.emoji-tab:hover {
    background: var(--color-background-tertiary, #2D2D2D);
}

.emoji-tab.active {
    background: rgba(233, 30, 140, 0.2);
}

.emoji-picker-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
    max-height: 200px;
    overflow-y: auto;
}

.emoji-picker-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 6px;
    font-size: 20px;
    cursor: pointer;
    transition: all 150ms;
}

.emoji-picker-btn:hover {
    background: var(--color-background-tertiary, #2D2D2D);
    transform: scale(1.1);
}

.emoji-picker-btn:active {
    transform: scale(0.95);
}

/* Scrollbar */
.emoji-picker-grid::-webkit-scrollbar {
    width: 6px;
}

.emoji-picker-grid::-webkit-scrollbar-track {
    background: transparent;
}

.emoji-picker-grid::-webkit-scrollbar-thumb {
    background: var(--color-border-default, #3D3D3D);
    border-radius: 3px;
}
`;

if (!document.getElementById('reaction-bar-styles')) {
    const style = document.createElement('style');
    style.id = 'reaction-bar-styles';
    style.textContent = reactionBarStyles;
    document.head.appendChild(style);
}

window.ReactionBar = ReactionBar;