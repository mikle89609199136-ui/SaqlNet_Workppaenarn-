import LocalStorage from './LocalStorage.js';

export class SessionStorage extends LocalStorage {
  constructor(storage = window.sessionStorage) {
    super(storage);
  }
}

export const sessionStorageAdapter = new SessionStorage();
export default SessionStorage;
