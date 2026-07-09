import { colors } from '../../theme/colors.json';

/**
 * CraneApp Avatar Component
 * Displays user image or initials with online status
 */
export class Avatar {
  constructor(options = {}) {
    this.src = options.src || null;
    this.alt = options.alt || 'User';
    this.size = options.size || '48px';
    this.name = options.name || '';
    this.online = options.online || false;
    this.onClick = options.onClick || null;
  }

  render() {
    const container = document.createElement('div');
    Object.assign(container.style, {
      position: 'relative',
      width: this.size,
      height: this.size,
      borderRadius: '50%',
      overflow: 'hidden',
      background: colors.surfaceVariant,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: '0',
      cursor: this.onClick ? 'pointer' : 'default'
    });

    if (this.onClick) {
      container.addEventListener('click', this.onClick);
    }

    if (this.src) {
      const img = document.createElement('img');
      img.src = this.src;
      img.alt = this.alt;
      Object.assign(img.style, {
        width: '100%',
        height: '100%',
        objectFit: 'cover'
      });
      container.appendChild(img);
    } else if (this.name) {
      const initials = this.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .substring(0, 2);
      
      const text = document.createElement('span');
      text.textContent = initials;
      Object.assign(text.style, {
        color: '#FFFFFF',
        fontWeight: '700',
        fontSize: `calc(${this.size} / 2.5)`,
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: this.getColorFromString(this.name)
      });
      container.appendChild(text);
    }

    if (this.online) {
      const status = document.createElement('div');
      Object.assign(status.style, {
        position: 'absolute',
        bottom: '0',
        right: '0',
        width: '25%',
        height: '25%',
        borderRadius: '50%',
        background: '#00FF00',
        border: `2px solid ${colors.background}`
      });
      container.appendChild(status);
    }

    return container;
  }

  getColorFromString(str) {
    const hues = ['#FF007F', '#9D00FF', '#2AABEE', '#FF9F00', '#00C853'];
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    return hues[Math.abs(hash) % hues.length];
  }
}