/**
 * Input validation utilities
 */

export function validatePhone(phone) {
  const regex = /^\+?[1-9]\d{1,14}$/;
  return regex.test(phone.replace(/[\s-]/g, ''));
}

export function validateEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

export function validateUsername(username) {
  const regex = /^[a-zA-Z0-9_]{5,32}$/;
  return regex.test(username);
}

export function validatePassword(password) {
  // Minimum 8 characters, at least one letter and one number
  const regex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;
  return regex.test(password);
}

export function validateCode(code) {
  const regex = /^\d{6}$/;
  return regex.test(code);
}

export function validateUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function sanitizeInput(input) {
  const div = document.createElement('div');
  div.textContent = input;
  return div.innerHTML;
}

/**
 * Escape HTML special characters to prevent XSS
 * Escapes & < > " ' / characters
 */
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"'\/]/g, function(c) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
      '/': '&#x2F;'
    }[c];
  });
}

/**
 * Escape HTML for use in attribute values (also escapes quotes)
 */
export function escapeAttr(str) {
  return escapeHtml(str);
}

export function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}