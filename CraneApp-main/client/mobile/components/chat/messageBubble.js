import { colors } from '../../theme/colors.json';
import { formatDate } from '../../utils/formatDate.js';
import { Avatar } from '../ui/avatar.js';

/**
 * Message Bubble Component
 * Displays individual messages in chat
 */
export class MessageBubble {
  constructor(options = {}) {
    this.id = options.id || `msg-${Date.now()}`;
    this.content = options.content || '';
    this.senderId = options.senderId || '';
    this.isOutgoing = options.isOutgoing || false;
    this.timestamp = options.timestamp || new Date();
    this.status = options.status || 'sent'; // sent, delivered, read
    this.type = options.type || 'text'; // text, image, video, audio, file
    this.mediaUrl = options.mediaUrl || null;
    this.replyTo = options.replyTo || null;
    this.reactions = options.reactions || [];
    this.isEdited = options.isEdited || false;
    this.onClick = options.onClick || null;
    this.onLongPress = options.onLongPress || null;
  }

  render() {
    const bubble = document.createElement('div');
    bubble.id = this.id;
    bubble.className = `message-bubble ${this.isOutgoing ? 'outgoing' : 'incoming'}`;
    
    Object.assign(bubble.style, {
      maxWidth: '70%',
      padding: '10px 12px',
      borderRadius: '16px',
      marginBottom: '8px',
      position: 'relative',
      cursor: 'pointer',
      alignSelf: this.isOutgoing ? 'flex-end' : 'flex-start',
      background: this.isOutgoing 
        ? `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 100%)`
        : colors.surfaceVariant,
      color: this.isOutgoing ? '#FFFFFF' : colors.textPrimary,
      boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
    });

    // Reply preview
    if (this.replyTo) {
      const replyPreview = document.createElement('div');
      replyPreview.className = 'reply-preview';
      Object.assign(replyPreview.style, {
        fontSize: '13px',
        color: this.isOutgoing ? 'rgba(255,255,255,0.7)' : colors.textSecondary,
        marginBottom: '6px',
        padding: '6px 8px',
        background: this.isOutgoing ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.1)',
        borderRadius: '8px',
        borderLeft: `3px solid ${this.isOutgoing ? '#FFFFFF' : colors.primary}`
      });
      replyPreview.textContent = this.replyTo;
      bubble.appendChild(replyPreview);
    }

    // Media content
    if (this.type === 'image' && this.mediaUrl) {
      const img = document.createElement('img');
      img.src = this.mediaUrl;
      img.alt = 'Image';
      Object.assign(img.style, {
        maxWidth: '100%',
        borderRadius: '12px',
        marginBottom: '6px',
        display: 'block'
      });
      img.addEventListener('click', () => this.openMediaViewer());
      bubble.appendChild(img);
    }

    // Text content
    if (this.content) {
      const text = document.createElement('div');
      text.className = 'message-text';
      Object.assign(text.style, {
        fontSize: '15px',
        lineHeight: '1.4',
        wordBreak: 'break-word'
      });
      text.textContent = this.content;
      bubble.appendChild(text);
    }

    // Metadata (time + status)
    const metadata = document.createElement('div');
    metadata.className = 'message-metadata';
    Object.assign(metadata.style, {
      fontSize: '11px',
      color: this.isOutgoing ? 'rgba(255,255,255,0.7)' : colors.textSecondary,
      marginTop: '4px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      gap: '4px'
    });

    const time = document.createElement('span');
    time.textContent = formatDate(this.timestamp, { hour: '2-digit', minute: '2-digit' });
    metadata.appendChild(time);

    // Status icons for outgoing messages
    if (this.isOutgoing) {
      const statusIcon = document.createElement('span');
      statusIcon.className = `message-status ${this.status}`;
      
      if (this.status === 'sent') {
        statusIcon.textContent = '✓';
      } else if (this.status === 'delivered') {
        statusIcon.textContent = '✓✓';
      } else if (this.status === 'read') {
        statusIcon.textContent = '✓✓';
        statusIcon.style.color = '#4FC3F7';
      }
      
      metadata.appendChild(statusIcon);
    }

    // Edited label
    if (this.isEdited) {
      const editedLabel = document.createElement('span');
      editedLabel.textContent = '(изм.)';
      editedLabel.style.fontSize = '10px';
      editedLabel.style.color = this.isOutgoing ? 'rgba(255,255,255,0.5)' : colors.textDisabled;
      metadata.appendChild(editedLabel);
    }

    bubble.appendChild(metadata);

    // Reactions
    if (this.reactions.length > 0) {
      const reactionsBar = document.createElement('div');
      reactionsBar.className = 'reactions-bar';
      Object.assign(reactionsBar.style, {
        position: 'absolute',
        bottom: '-10px',
        right: this.isOutgoing ? '0' : 'auto',
        left: this.isOutgoing ? 'auto' : '0',
        background: colors.surface,
        borderRadius: '12px',
        padding: '4px 6px',
        display: 'flex',
        gap: '4px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        border: `1px solid ${colors.border}`
      });

      this.reactions.forEach(reaction => {
        const reactionEmoji = document.createElement('span');
        reactionEmoji.textContent = reaction.emoji;
        reactionEmoji.style.fontSize = '14px';
        reactionEmoji.style.cursor = 'pointer';
        reactionsBar.appendChild(reactionEmoji);
      });

      bubble.appendChild(reactionsBar);
    }

    // Event listeners
    bubble.addEventListener('click', () => {
      if (this.onClick) this.onClick(this.id);
    });

    bubble.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.onLongPress) this.onLongPress(this.id, e);
    });

    return bubble;
  }

  openMediaViewer() {
    if (this.mediaUrl) {
      window.location.href = this.mediaUrl;
    }
  }

  updateStatus(newStatus) {
    this.status = newStatus;
    const bubble = document.getElementById(this.id);
    if (bubble) {
      const statusIcon = bubble.querySelector('.message-status');
      if (statusIcon) {
        if (newStatus === 'sent') {
          statusIcon.textContent = '✓';
          statusIcon.style.color = '';
        } else if (newStatus === 'delivered') {
          statusIcon.textContent = '✓✓';
          statusIcon.style.color = '';
        } else if (newStatus === 'read') {
          statusIcon.textContent = '✓✓';
          statusIcon.style.color = '#4FC3F7';
        }
      }
    }
  }
}
