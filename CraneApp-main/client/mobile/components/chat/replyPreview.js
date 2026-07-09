import { colors } from '../../theme/colors.json';

/**
 * Reply Preview Component
 * Shows quoted message when replying
 */
export class ReplyPreview {
  constructor(options = {}) {
    this.content = options.content || '';
    this.senderName = options.senderName || '';
    this.messageType = options.messageType || 'text';
    this.onClose = options.onClose || (() => {});
    this.id = `reply-${Date.now()}`;
  }

  render() {
    const container = document.createElement('div');
    container.id = this.id;
    container.className = 'reply-preview-container';
    
    Object.assign(container.style, {
      background: colors.surfaceVariant,
      borderLeft: `4px solid ${colors.primary}`,
      padding: '10px 12px',
      marginBottom: '8px',
      borderRadius: '8px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      maxWidth: '100%'
    });

    const content = document.createElement('div');
    content.style.flex = '1';
    content.style.overflow = 'hidden';

    if (this.senderName) {
      const sender = document.createElement('div');
      sender.className = 'reply-sender';
      sender.textContent = this.senderName;
      Object.assign(sender.style, {
        fontSize: '13px',
        fontWeight: '600',
        color: colors.primary,
        marginBottom: '4px'
      });
      content.appendChild(sender);
    }

    const message = document.createElement('div');
    message.className = 'reply-message';
    message.textContent = this.content;
    Object.assign(message.style, {
      fontSize: '14px',
      color: colors.textSecondary,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    });
    content.appendChild(message);

    container.appendChild(content);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'reply-close';
    closeBtn.textContent = '✕';
    Object.assign(closeBtn.style, {
      width: '28px',
      height: '28px',
      borderRadius: '50%',
      border: 'none',
      background: 'transparent',
      color: colors.textSecondary,
      fontSize: '16px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    });
    closeBtn.addEventListener('click', () => {
      this.close();
      this.onClose();
    });
    container.appendChild(closeBtn);

    return container;
  }

  close() {
    const container = document.getElementById(this.id);
    if (container) {
      container.style.opacity = '0';
      container.style.transform = 'translateY(-10px)';
      setTimeout(() => {
        container.remove();
      }, 200);
    }
  }

  setContent(text) {
    const message = document.querySelector(`#${this.id} .reply-message`);
    if (message) {
      message.textContent = text;
    }
  }

  setSender(name) {
    const sender = document.querySelector(`#${this.id} .reply-sender`);
    if (sender) {
      sender.textContent = name;
    }
  }
}