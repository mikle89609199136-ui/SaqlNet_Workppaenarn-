class LocalStorage {
  constructor(storage = window.localStorage) {
    this.storage = storage;
  }

  get(key) {
    try {
      return this.storage.getItem(key);
    } catch (error) {
      console.error('LocalStorage get failed:', error);
      return null;
    }
  }

  getJson(key) {
    const value = this.get(key);
    if (!value) return null;

    try {
      return JSON.parse(value);
    } catch (error) {
      console.error('LocalStorage JSON parse failed:', error);
      return null;
    }
  }

  set(key, value) {
    try {
      this.storage.setItem(key, value);
      return true;
    } catch (error) {
      console.error('LocalStorage set failed:', error);
      return false;
    }
  }

  setJson(key, value) {
    return this.set(key, JSON.stringify(value));
  }

  remove(key) {
    try {
      this.storage.removeItem(key);
      return true;
    } catch (error) {
      console.error('LocalStorage remove failed:', error);
      return false;
    }
  }

  clear() {
    try {
      this.storage.clear();
      return true;
    } catch (error) {
      console.error('LocalStorage clear failed:', error);
      return false;
    }
  }
}

export const localStorageAdapter = new LocalStorage();
export default LocalStorage;
