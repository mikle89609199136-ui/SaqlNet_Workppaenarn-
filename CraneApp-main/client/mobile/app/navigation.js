/**
 * Navigation System for CraneApp
 */

export const navigation = {
  history: [],
  currentPath: null,

  init() {
    window.addEventListener('popstate', (e) => {
      if (e.state) {
        this.currentPath = e.state.path;
      }
    });
  },

  navigate(path, params = {}) {
    this.history.push(this.currentPath);
    this.currentPath = path;
    
    // Add query params if exists
    const queryString = Object.keys(params)
      .map(key => `${key}=${encodeURIComponent(params[key])}`)
      .join('&');
    
    const url = queryString ? `${path}?${queryString}` : path;
    
    window.history.pushState({ path }, '', url);
    window.location.href = path;
  },

  back() {
    if (this.history.length > 0) {
      const previousPath = this.history.pop();
      window.history.back();
    }
  },

  replace(path) {
    this.currentPath = path;
    window.history.replaceState({ path }, '', path);
    window.location.href = path;
  },

  getPath() {
    return this.currentPath || window.location.pathname;
  },

  getParams() {
    const params = new URLSearchParams(window.location.search);
    return Object.fromEntries(params);
  }
};