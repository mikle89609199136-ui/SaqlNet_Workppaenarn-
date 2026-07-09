class Component {
  constructor(props = {}) {
    this.props = props;
    this.state = {};
    this.element = null;
    this.children = {};
    this.eventListeners = [];
    this.boundListeners = [];
  }

  setState(nextState) {
    const previousState = { ...this.state };
    this.state = { ...this.state, ...nextState };
    this.onStateChange(previousState, this.state);
    this.update();
  }

  componentWillMount() {}
  componentDidMount() {}
  componentWillUpdate() {}
  componentDidUpdate() {}
  componentWillUnmount() {}
  onStateChange() {}

  render() {
    return '';
  }

  mount(container = null) {
    this.componentWillMount();
    this.element = this.createElement();

    if (container) {
      container.appendChild(this.element);
    }

    this.attachEventListeners();
    this.mountChildren();
    this.componentDidMount();

    return this.element;
  }

  update() {
    if (!this.element?.parentElement) return;

    this.componentWillUpdate();

    const parent = this.element.parentElement;
    const nextSibling = this.element.nextSibling;
    this.detachEventListeners();
    this.unmountChildren();
    this.element.remove();
    this.element = this.createElement();

    if (nextSibling) {
      parent.insertBefore(this.element, nextSibling);
    } else {
      parent.appendChild(this.element);
    }

    this.attachEventListeners();
    this.mountChildren();
    this.componentDidUpdate();
  }

  unmount() {
    this.componentWillUnmount();
    this.detachEventListeners();
    this.unmountChildren();
    this.element?.remove();
    this.element = null;
  }

  addEventListener(selector, event, handler) {
    this.eventListeners.push({ selector, event, handler });
  }

  createElement() {
    const template = document.createElement('template');
    template.innerHTML = this.render().trim();
    return template.content.firstElementChild;
  }

  attachEventListeners() {
    this.boundListeners = this.eventListeners.flatMap(({ selector, event, handler }) => {
      const elements = selector === 'root'
        ? [this.element]
        : Array.from(this.element.querySelectorAll(selector));

      return elements.map((element) => {
        const boundHandler = handler.bind(this);
        element.addEventListener(event, boundHandler);
        return { element, event, boundHandler };
      });
    });
  }

  detachEventListeners() {
    this.boundListeners.forEach(({ element, event, boundHandler }) => {
      element.removeEventListener(event, boundHandler);
    });
    this.boundListeners = [];
  }

  mountChildren() {
    Object.entries(this.children).forEach(([name, child]) => {
      const placeholder = this.element.querySelector(`[data-component="${name}"]`);
      if (placeholder && child) {
        placeholder.replaceWith(child.mount());
      }
    });
  }

  unmountChildren() {
    Object.values(this.children).forEach((child) => child?.unmount?.());
  }
}

export default Component;
