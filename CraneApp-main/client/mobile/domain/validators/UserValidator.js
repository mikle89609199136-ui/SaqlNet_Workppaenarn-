class UserValidator {
  static validatePhone(phone) {
    const normalized = String(phone ?? '').trim();

    if (!normalized) {
      return { isValid: false, error: 'Phone is required' };
    }

    if (!/^\+?[0-9\s()-]{7,20}$/.test(normalized)) {
      return { isValid: false, error: 'Invalid phone format' };
    }

    return { isValid: true };
  }

  static validateEmail(email) {
    if (!email) {
      return { isValid: false, error: 'Email is required' };
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { isValid: false, error: 'Invalid email format' };
    }

    return { isValid: true };
  }

  static validateUsername(username) {
    if (!username) {
      return { isValid: false, error: 'Username is required' };
    }

    if (username.length < 3 || username.length > 30) {
      return { isValid: false, error: 'Username must be 3-30 characters' };
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      return { isValid: false, error: 'Username contains unsupported characters' };
    }

    return { isValid: true };
  }
}

export default UserValidator;
