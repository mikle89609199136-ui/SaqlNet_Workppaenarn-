/**
 * Encryption utilities for secure data handling
 *
 * WARNING: encodeLocalStorage/decodeLocalStorage use base64 encoding,
 * NOT encryption. This provides obfuscation only, not security.
 * Do NOT store sensitive data using these functions.
 */

export async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function generateSecureToken(length = 32) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Renamed to reflect actual behavior (encoding, not encryption)
export function encodeLocalStorage(key, data) {
  try {
    const encoded = btoa(JSON.stringify(data));
    localStorage.setItem(key, encoded);
    return true;
  } catch (error) {
    console.error('Encoding error:', error);
    return false;
  }
}

export function decodeLocalStorage(key) {
  try {
    const encoded = localStorage.getItem(key);
    if (!encoded) return null;
    const decoded = atob(encoded);
    return JSON.parse(decoded);
  } catch (error) {
    console.error('Decoding error:', error);
    return null;
  }
}

// Legacy aliases (deprecated)
export const encryptLocalStorage = encodeLocalStorage;
export const decryptLocalStorage = decodeLocalStorage;

export function generateVerificationCode(length = 6) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte % 10).join('');
}