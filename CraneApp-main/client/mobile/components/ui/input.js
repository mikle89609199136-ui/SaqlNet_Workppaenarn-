import { colors } from '../../theme/colors.json';

/**
 * CraneApp Input Component
 * Supports validation, labels, and error states
 */
export class Input {
  constructor(options = {}) {
    this.type = options.type || 'text';
    this.placeholder = options.placeholder || '';
    this.value = options.value || '';
    this.onChange = options.onChange || (() => {});
    this.error = options.error || '';
    this.label = options.label || '';
    this.id = `input-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.icon = options.icon || null;
  }

  render() {
    const container = document.createElement('div');
    container.style.marginBottom = '16px';
    container.style.width = '100%';
    container.style.position = 'relative';

    if (this.label) {
      const label = document.createElement('label');
      label.textContent = this.label;
      label.setAttribute('for', this.id);
      Object.assign(label.style, {
        display: 'block',
        color: colors.textSecondary,
        fontSize: '14px',
        marginBottom: '8px',
        fontWeight: '500'
      });
      container.appendChild(label);
    }

    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    wrapper.style.display = 'flex';
    wrapper.style.alignItems = 'center';

    if (this.icon) {
      const iconSpan = document.createElement('span');
      iconSpan.textContent = this.icon;
      Object.assign(iconSpan.style, {
        position: 'absolute',
        left: '14px',
        color: colors.textSecondary,
        fontSize: '18px',
        zIndex: '1'
      });
      wrapper.appendChild(iconSpan);
    }

    const input = document.createElement('input');
    input.type = this.type;
    input.id = this.id;
    input.value = this.value;
    input.placeholder = this.placeholder;
    
    Object.assign(input.style, {
      width: '100%',
      height: '48px',
      borderRadius: '12px',
      border: `1px solid ${this.error ? '#FF4B4B' : colors.border}`,
      background: colors.inputBackground,
      color: colors.textPrimary,
      padding: this.icon ? '0 14px 0 42px' : '0 14px',
      fontSize: '16px',
      outline: 'none',
      transition: 'border-color 0.2s, box-shadow 0.2s',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    });

    input.addEventListener('focus', () => {
      input.style.borderColor = colors.primary;
      input.style.boxShadow = `0 0 0 2px ${colors.primary}20`;
    });

    input.addEventListener('blur', () => {
      input.style.borderColor = this.error ? '#FF4B4B' : colors.border;
      input.style.boxShadow = 'none';
    });

    input.addEventListener('input', (e) => {
      this.value = e.target.value;
      this.onChange(e.target.value);
      if (this.error) {
        this.setError('');
      }
    });

    wrapper.appendChild(input);
    container.appendChild(wrapper);

    if (this.error) {
      const errorText = document.createElement('span');
      errorText.textContent = this.error;
      Object.assign(errorText.style, {
        color: '#FF4B4B',
        fontSize: '12px',
        marginTop: '4px',
        display: 'block'
      });
      container.appendChild(errorText);
    }

    return container;
  }

  setValue(val) {
    this.value = val;
    const input = document.getElementById(this.id);
    if (input) input.value = val;
  }

  getValue() {
    return this.value;
  }

  setError(msg) {
    this.error = msg;
    const input = document.getElementById(this.id);
    const container = input ? input.closest('div') : null;
    if (input) {
      input.style.borderColor = msg ? '#FF4B4B' : colors.border;
    }
    if (container) {
      const existingError = container.querySelector('span[style*="color: #FF4B4B"]');
      if (existingError) existingError.remove();
      if (msg) {
        const errorText = document.createElement('span');
        errorText.textContent = msg;
        Object.assign(errorText.style, {
          color: '#FF4B4B',
          fontSize: '12px',
          marginTop: '4px',
          display: 'block'
        });
        container.appendChild(errorText);
      }
    }
  }
}