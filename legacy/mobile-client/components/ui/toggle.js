import { colors } from '../../theme/colors.json';

/**
 * CraneApp Toggle Switch Component
 */
export class Toggle {
  constructor(options = {}) {
    this.checked = options.checked || false;
    this.onChange = options.onChange || (() => {});
    this.id = `toggle-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  render() {
    const container = document.createElement('div');
    container.style.position = 'relative';
    container.style.width = '40px';
    container.style.height = '20px';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = this.id;
    input.checked = this.checked;
    input.style.opacity = '0';
    input.style.width = '0';
    input.style.height = '0';
    input.style.position = 'absolute';

    const slider = document.createElement('span');
    slider.style.position = 'absolute';
    slider.style.cursor = 'pointer';
    slider.style.top = '0';
    slider.style.left = '0';
    slider.style.right = '0';
    slider.style.bottom = '0';
    slider.style.background = colors.textDisabled;
    slider.style.borderRadius = '20px';
    slider.style.transition = '0.3s';

    const knob = document.createElement('span');
    knob.style.position = 'absolute';
    knob.style.height = '16px';
    knob.style.width = '16px';
    knob.style.left = '2px';
    knob.style.bottom = '2px';
    knob.style.background = '#FFFFFF';
    knob.style.borderRadius = '50%';
    knob.style.transition = '0.3s';
    knob.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';

    slider.appendChild(knob);
    container.appendChild(input);
    container.appendChild(slider);

    const updateState = () => {
      if (input.checked) {
        slider.style.background = colors.primary;
        knob.style.transform = 'translateX(20px)';
      } else {
        slider.style.background = colors.textDisabled;
        knob.style.transform = 'translateX(0)';
      }
      this.checked = input.checked;
      this.onChange(this.checked);
    };

    input.addEventListener('change', updateState);
    setTimeout(updateState, 0);

    return container;
  }

  setChecked(val) {
    const input = document.getElementById(this.id);
    if (input) {
      input.checked = val;
      input.dispatchEvent(new Event('change'));
    }
  }
}