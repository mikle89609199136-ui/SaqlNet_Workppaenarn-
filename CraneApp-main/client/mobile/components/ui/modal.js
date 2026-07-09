import { colors } from '../../theme/colors.json';
import { Button } from './button.js';

/**
 * CraneApp Modal Component
 */
export class Modal {
  constructor(options = {}) {
    this.title = options.title || '';
    this.content = options.content || '';
    this.onClose = options.onClose || (() => {});
    this.actions = options.actions || [];
  }

  render() {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.background = 'rgba(0, 0, 0, 0.7)';
    overlay.style.zIndex = '1000';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.backdropFilter = 'blur(4px)';

    const modal = document.createElement('div');
    modal.style.background = colors.surface;
    modal.style.width = '90%';
    modal.style.maxWidth = '400px';
    modal.style.borderRadius = '16px';
    modal.style.padding = '24px';
    modal.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';
    modal.style.animation = 'modalSlideIn 0.3s ease';

    if (this.title) {
      const title = document.createElement('h3');
      title.textContent = this.title;
      title.style.margin = '0 0 16px 0';
      title.style.color = colors.textPrimary;
      title.style.fontSize = '20px';
      modal.appendChild(title);
    }

    if (this.content) {
      const content = document.createElement('div');
      content.innerHTML = this.content;
      content.style.color = colors.textSecondary;
      content.style.marginBottom = '24px';
      content.style.fontSize = '16px';
      content.style.lineHeight = '1.5';
      modal.appendChild(content);
    }

    const actionsContainer = document.createElement('div');
    actionsContainer.style.display = 'flex';
    actionsContainer.style.justifyContent = 'flex-end';
    actionsContainer.style.gap = '12px';

    const closeBtn = new Button({
      label: 'Cancel',
      type: 'text',
      onClick: () => {
        this.close();
        this.onClose();
      }
    });
    actionsContainer.appendChild(closeBtn.render());

    this.actions.forEach(action => {
      const btn = new Button({
        label: action.label,
        type: action.type || 'primary',
        onClick: () => {
          action.onClick();
          this.close();
        }
      });
      actionsContainer.appendChild(btn.render());
    });

    modal.appendChild(actionsContainer);
    overlay.appendChild(modal);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.close();
        this.onClose();
      }
    });

    document.body.appendChild(overlay);
    this.element = overlay;
    return overlay;
  }

  close() {
    if (this.element) {
      this.element.style.opacity = '0';
      setTimeout(() => {
        this.element.remove();
      }, 300);
    }
  }
}