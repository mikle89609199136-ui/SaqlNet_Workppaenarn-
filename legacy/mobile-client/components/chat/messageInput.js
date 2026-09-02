import { colors } from '../../theme/colors.json';

/**
 * Message Input Component
 * Chat input field with attach, emoji, and send buttons
 */
export class MessageInput {
  constructor(options = {}) {
    this.placeholder = options.placeholder || 'Сообщение...';
    this.onSend = options.onSend || (() => {});
    this.onAttach = options.onAttach || (() => {});
    this.onEmoji = options.onEmoji || (() => {});
    this.onVoice = options.onVoice || (() => {});
    this.onTyping = options.onTyping || (() => {});
    this.id = `input-${Date.now()}`;
    this.maxLength = options.maxLength || 4096;
  }

  render() {
    const container = document.createElement('div');
    container.id = this.id;
    container.className = 'message-input-container';
    
    Object.assign(container.style, {
      height: '56px',
      background: colors.surface,
      borderTop: `1px solid ${colors.border}`,
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      gap: '8px',
      position: 'fixed',
      bottom: '0',
      left: '0',
      width: '100%',
      zIndex: '100'
    });

    // Attach button
    const attachBtn = document.createElement('button');
    attachBtn.className = 'attach-btn';
    attachBtn.textContent = '📎';
    Object.assign(attachBtn.style, {
      width: '40px',
      height: '40px',
      borderRadius: '50%',
      border: 'none',
      background: 'transparent',
      fontSize: '20px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'background 0.2s'
    });
    attachBtn.addEventListener('mouseenter', () => {
      attachBtn.style.background = colors.surfaceVariant;
    });
    attachBtn.addEventListener('mouseleave', () => {
      attachBtn.style.background = 'transparent';
    });
    attachBtn.addEventListener('click', () => this.onAttach());
    container.appendChild(attachBtn);

    // Input field
    const inputWrapper = document.createElement('div');
    inputWrapper.style.flex = '1';
    inputWrapper.style.position = 'relative';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'message-input-field';
    input.placeholder = this.placeholder;
    input.maxLength = this.maxLength;
    
    Object.assign(input.style, {
      width: '100%',
      height: '40px',
      borderRadius: '20px',
      border: `1px solid ${colors.border}`,
      background: colors.surfaceVariant,
      color: colors.textPrimary,
      padding: '0 16px',
      fontSize: '15px',
      outline: 'none',
      transition: 'border-color 0.2s'
    });

    input.addEventListener('focus', () => {
      input.style.borderColor = colors.primary;
    });

    input.addEventListener('blur', () => {
      input.style.borderColor = colors.border;
    });

    input.addEventListener('input', (e) => {
      this.onTyping(e.target.value);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    inputWrapper.appendChild(input);
    container.appendChild(inputWrapper);

    // Emoji button
    const emojiBtn = document.createElement('button');
    emojiBtn.className = 'emoji-btn';
    emojiBtn.textContent = '😀';
    Object.assign(emojiBtn.style, {
      width: '40px',
      height: '40px',
      borderRadius: '50%',
      border: 'none',
      background: 'transparent',
      fontSize: '20px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    });
    emojiBtn.addEventListener('click', () => this.onEmoji());
    container.appendChild(emojiBtn);

    // Send button
    const sendBtn = document.createElement('button');
    sendBtn.id = 'sendBtn';
    sendBtn.className = 'send-btn';
    sendBtn.textContent = '➤';
    Object.assign(sendBtn.style, {
      width: '40px',
      height: '40px',
      borderRadius: '50%',
      border: 'none',
      background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 100%)`,
      color: '#FFFFFF',
      fontSize: '18px',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      transition: 'transform 0.2s, opacity 0.2s',
      boxShadow: '0 2px 8px rgba(255, 0, 127, 0.3)'
    });
    sendBtn.addEventListener('mouseenter', () => {
      sendBtn.style.transform = 'scale(1.1)';
    });
    sendBtn.addEventListener('mouseleave', () => {
      sendBtn.style.transform = 'scale(1)';
    });
    sendBtn.addEventListener('click', () => this.sendMessage());
    container.appendChild(sendBtn);

    this.inputElement = input;
    this.sendButton = sendBtn;
    this.container = container;

    return container;
  }

  sendMessage() {
    const text = this.inputElement.value.trim();
    if (text) {
      this.onSend(text);
      this.inputElement.value = '';
      this.onTyping('');
    }
  }

  getValue() {
    return this.inputElement.value;
  }

  setValue(text) {
    this.inputElement.value = text;
  }

  clear() {
    this.inputElement.value = '';
    this.onTyping('');
  }

  setPlaceholder(text) {
    this.inputElement.placeholder = text;
  }

  setDisabled(state) {
    this.inputElement.disabled = state;
    this.sendButton.disabled = state;
    this.sendButton.style.opacity = state ? '0.5' : '1';
  }

  showTypingIndicator(show) {
    const indicator = this.container.querySelector('.typing-indicator');
    if (show) {
      if (!indicator) {
        const typing = document.createElement('div');
        typing.className = 'typing-indicator';
        typing.textContent = 'печатает...';
        Object.assign(typing.style, {
          position: 'absolute',
          top: '-20px',
          left: '12px',
          fontSize: '12px',
          color: colors.textSecondary
        });
        this.container.appendChild(typing);
      }
    } else if (indicator) {
      indicator.remove();
    }
  }
}