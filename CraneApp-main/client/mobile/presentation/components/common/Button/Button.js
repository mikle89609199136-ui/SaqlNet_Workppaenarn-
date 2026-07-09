import Component from '../../../../core/Component.js';
import { escapeHtml } from '../../../../shared/utils/html.js';

class Button extends Component {
  constructor(props = {}) {
    super({
      text: 'Button',
      variant: 'primary',
      size: 'medium',
      disabled: false,
      loading: false,
      onClick: () => {},
      ...props,
    });

    this.addEventListener('root', 'click', this.handleClick);
  }

  handleClick(event) {
    if (this.props.disabled || this.props.loading) {
      event.preventDefault();
      return;
    }

    this.props.onClick(event);
  }

  render() {
    const { text, variant, size, disabled, loading } = this.props;
    const className = [
      'button',
      `button--${variant}`,
      `button--${size}`,
      disabled && 'button--disabled',
      loading && 'button--loading',
    ].filter(Boolean).join(' ');

    return `
      <button class="${className}" ${disabled ? 'disabled' : ''}>
        ${loading ? '<span class="button__spinner"></span>' : ''}
        <span class="button__text">${escapeHtml(text)}</span>
      </button>
    `;
  }
}

export default Button;
