export const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export const ALLOWED_AVATAR_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export type TAvatarValidationError = 'invalidType' | 'tooLarge';

export interface IValidationResult {
  errorCode?: TAvatarValidationError;
  valid: boolean;
}

export function validateAvatarFile(file: File): IValidationResult {
  const isAllowedType = ALLOWED_AVATAR_TYPES.includes(
    file.type as (typeof ALLOWED_AVATAR_TYPES)[number]
  );

  if (!isAllowedType) {
    return {
      errorCode: 'invalidType',
      valid: false,
    };
  }

  if (file.size > MAX_AVATAR_SIZE_BYTES) {
    return {
      errorCode: 'tooLarge',
      valid: false,
    };
  }

  return { valid: true };
}
