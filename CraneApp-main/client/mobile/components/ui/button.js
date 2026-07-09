import { colors } from '../../theme/colors.json';

/**
 * CraneApp Button Component
 * Supports primary, secondary, danger, and text types
 */
export class Button {
  constructor(options = {}) {
    this.label = options.label || 'Button';
    this.onClick = options.onClick || (() => {});
    this.type = options.type || 'primary';
    this.disabled = options.disabled || false;
    this.icon = options.icon || null;
    this.width = options.width || '100%';
    this.height = options.height || '48px';
    this.id = `btn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  render() {
    const button = document.createElement('button');
    button.id = this.id;
    button.className = `crane-btn crane-btn--${this.type}`;
    button.textContent = this.label;
    
    Object.assign(button.style, {
      width: this.width,
      height: this.height,
      borderRadius: '12px',
      border: 'none',
      cursor: this.disabled ? 'not-allowed' : 'pointer',
      fontWeight: '600',
      fontSize: '16px',
      transition: 'all 0.2s ease',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      outline: 'none',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    });

    this.applyTheme(button);

    if (!this.disabled) {
      button.addEventListener('mouseenter', () => this.handleHover(button, true));
      button.addEventListener('mouseleave', () => this.handleHover(button, false));
      button.addEventListener('click', (e) => {
        e.preventDefault();
        this.onClick();
      });
    }

    if (this.icon) {
      const iconSpan = document.createElement('span');
      iconSpan.textContent = this.icon;
      iconSpan.style.fontSize = '18px';
      button.insertBefore(iconSpan, button.firstChild);
    }

    return button;
  }

  applyTheme(element) {
    const { primary, secondary, onPrimary, onSecondary, surfaceVariant, textPrimary, textDisabled } = colors;
    
    if (this.type === 'primary') {
      element.style.background = this.disabled ? surfaceVariant : primary;
      element.style.color = onPrimary;
      element.style.boxShadow = this.disabled ? 'none' : `0 4px 12px ${primary}40`;
    } else if (this.type === 'secondary') {
      element.style.background = this.disabled ? surfaceVariant : secondary;
      element.style.color = onSecondary;
    } else if (this.type === 'danger') {
      element.style.background = this.disabled ? surfaceVariant : '#FF4B4B';
      element.style.color = '#FFFFFF';
    } else {
      element.style.background = 'transparent';
      element.style.color = this.disabled ? textDisabled : primary;
    }
  }

  handleHover(element, isHover) {
    if (this.disabled) return;
    element.style.transform = isHover ? 'scale(1.02)' : 'scale(1)';
    element.style.opacity = isHover ? '0.95' : '1';
  }

  setDisabled(state) {
    this.disabled = state;
    const btn = document.getElementById(this.id);
    if (btn) {
      btn.disabled = state;
      btn.style.cursor = state ? 'not-allowed' : 'pointer';
      this.applyTheme(btn);
    }
  }
}