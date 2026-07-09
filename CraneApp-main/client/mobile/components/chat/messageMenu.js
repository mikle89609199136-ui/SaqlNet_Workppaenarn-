/**
 * CraneApp Message Menu Component
 * Context menu for message actions
 */

class MessageMenu {
    constructor(options = {}) {
        this.options = {
            message: options.message || null,
            position: options.position || { x: 0, y: 0 },
            onReply: options.onReply || null,
            onEdit: options.onEdit || null,
            onDelete: options.onDelete || null,
            onForward: options.onForward || null,
            onCopy: options.onCopy || null,
            onPin: options.onPin || null,
            onSelect: options.onSelect || null,
            onReact: options.onReact || null,
            canEdit: options.canEdit || false,
            canPin: options.canPin || false,
            canDelete: options.canDelete || true,
            className: options.className || '',
            ...options
        };
        
        this.element = null;
        this.reactionPickerOpen = false;
        this.render();
    }

    render() {
        // Overlay
        this.element = document.createElement('div');
        this.element.className = `message-menu-overlay ${this.options.className}`;
        
        // Menu container
        const menu = document.createElement('div');
        menu.className = 'message-menu';
        menu.style.top = `${this.options.position.y}px`;
        menu.style.left = `${Math.min(this.options.position.x, window.innerWidth - 200)}px`;
        
        // Quick reactions row
        const reactionRow = document.createElement('div');
        reactionRow.className = 'quick-reactions';
        
        const quickEmojis = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
        quickEmojis.forEach(emoji => {
            const btn = document.createElement('button');
            btn.className = 'quick-reaction-btn';
            btn.textContent = emoji;
            btn.addEventListener('click', () => {
                this.options.onReact?.(this.options.message?.id, emoji);
                this.close();
            });
            reactionRow.appendChild(btn);
        });
        
        menu.appendChild(reactionRow);
        
        // Divider
        const divider = document.createElement('div');
        divider.className = 'menu-divider';
        menu.appendChild(divider);
        
        // Menu items
        const items = this.getMenuItems();
        
        items.forEach(item => {
            if (item.hidden) return;
            
            const menuItem = document.createElement('button');
            menuItem.className = `menu-item ${item.danger ? 'danger' : ''} ${item.disabled ? 'disabled' : ''}`;
            menuItem.disabled = item.disabled || false;
            
            menuItem.innerHTML = `
                <span class="menu-item-icon">${item.icon}</span>
                <span class="menu-item-label">${item.label}</span>
            `;
            
            if (!item.disabled) {
                menuItem.addEventListener('click', () => {
                    item.action?.();
                    this.close();
                });
            }
            
            menu.appendChild(menuItem);
        });
        
        this.element.appendChild(menu);
        
        // Close on overlay click
        this.element.addEventListener('click', (e) => {
            if (e.target === this.element) {
                this.close();
            }
        });
        
        // Close on escape
        this.handleEscape = (e) => {
            if (e.key === 'Escape') {
                this.close();
            }
        };
        document.addEventListener('keydown', this.handleEscape);
        
        return this.element;
    }

    getMenuItems() {
        const message = this.options.message;
        
        return [
            {
                label: 'Reply',
                icon: this.getIcon('reply'),
                action: () => this.options.onReply?.(message),
                hidden: false
            },
            {
                label: 'Copy',
                icon: this.getIcon('copy'),
                action: () => {
                    navigator.clipboard.writeText(message?.content || '');
                    this.options.onCopy?.(message?.content);
                },
                hidden: message?.type !== 'text'
            },
            {
                label: 'Forward',
                icon: this.getIcon('forward'),
                action: () => this.options.onForward?.(message),
                hidden: false
            },
            {
                label: 'Edit',
                icon: this.getIcon('edit'),
                action: () => this.options.onEdit?.(message),
                hidden: !this.options.canEdit
            },
            {
                label: 'Pin',
                icon: this.getIcon('pin'),
                action: () => this.options.onPin?.(message),
                hidden: !this.options.canPin
            },
            {
                label: 'Select',
                icon: this.getIcon('select'),
                action: () => this.options.onSelect?.(message),
                hidden: false
            },
            {
                label: 'Delete',
                icon: this.getIcon('delete'),
                action: () => this.options.onDelete?.(message?.id),
                danger: true,
                hidden: !this.options.canDelete
            }
        ];
    }

    getIcon(type) {
        const icons = {
            reply: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 17 4 12 9 7"></polyline>
                <path d="M20 18v-2a4 4 0 0 0-4-4H4"></path>
            </svg>`,
            copy: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>`,
            forward: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="15 17 20 12 15 7"></polyline>
                <path d="M4 18v-2a4 4 0 0 1 4-4h12"></path>
            </svg>`,
            edit: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>`,
            pin: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
            </svg>`,
            select: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 11 12 14 22 4"></polyline>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
            </svg>`,
            delete: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>`
        };
        
        return icons[type] || '';
    }

    open() {
        document.body.appendChild(this.element);
        
        // Adjust position if menu goes off screen
        requestAnimationFrame(() => {
            const menu = this.element.querySelector('.message-menu');
            const rect = menu.getBoundingClientRect();
            
            if (rect.bottom > window.innerHeight) {
                menu.style.top = `${window.innerHeight - rect.height - 20}px`;
            }
            
            if (rect.right > window.innerWidth) {
                menu.style.left = `${window.innerWidth - rect.width - 20}px`;
            }
        });
    }

    close() {
        if (this.handleEscape) {
            document.removeEventListener('keydown', this.handleEscape);
        }
        
        this.element.classList.add('closing');
        
        setTimeout(() => {
            this.element.remove();
        }, 150);
    }

    getElement() {
        return this.element;
    }
}

// CSS for MessageMenu
const messageMenuStyles = `
.message-menu-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1000;
    animation: fadeIn 150ms ease-out;
}

.message-menu-overlay.closing {
    animation: fadeOut 150ms ease-out forwards;
}

@keyframes fadeIn {
    from { background: rgba(0, 0, 0, 0); }
    to { background: rgba(0, 0, 0, 0.3); }
}

@keyframes fadeOut {
    from { background: rgba(0, 0, 0, 0.3); }
    to { background: rgba(0, 0, 0, 0); }
}

.message-menu {
    position: absolute;
    min-width: 180px;
    background: var(--color-background-secondary, #121212);
    border-radius: 12px;
    padding: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    animation: scaleIn 150ms ease-out;
}

.message-menu-overlay.closing .message-menu {
    animation: scaleOut 150ms ease-out forwards;
}

@keyframes scaleIn {
    from { transform: scale(0.95); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
}

@keyframes scaleOut {
    from { transform: scale(1); opacity: 1; }
    to { transform: scale(0.95); opacity: 0; }
}

.quick-reactions {
    display: flex;
    justify-content: space-around;
    padding: 8px 4px;
}

.quick-reaction-btn {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 50%;
    font-size: 24px;
    cursor: pointer;
    transition: transform 150ms;
}

.quick-reaction-btn:hover {
    transform: scale(1.2);
}

.quick-reaction-btn:active {
    transform: scale(0.95);
}

.menu-divider {
    height: 1px;
    background: var(--color-border-default, #3D3D3D);
    margin: 8px 0;
}

.menu-item {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 12px 16px;
    background: transparent;
    border: none;
    border-radius: 8px;
    color: var(--color-text-primary, #FFFFFF);
    font-size: 15px;
    cursor: pointer;
    text-align: left;
    transition: background 150ms;
}

.menu-item:hover:not(.disabled) {
    background: var(--color-background-tertiary, #2D2D2D);
}

.menu-item.danger {
    color: #F44336;
}

.menu-item.danger:hover {
    background: rgba(244, 67, 54, 0.1);
}

.menu-item.disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.menu-item-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
}

.menu-item-label {
    flex: 1;
}
`;

if (!document.getElementById('message-menu-styles')) {
    const style = document.createElement('style');
    style.id = 'message-menu-styles';
    style.textContent = messageMenuStyles;
    document.head.appendChild(style);
}

window.MessageMenu = MessageMenu;