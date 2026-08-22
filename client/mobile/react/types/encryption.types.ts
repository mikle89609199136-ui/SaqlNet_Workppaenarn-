export interface IEncryptedMedia {
  version: number;
  encrypted: boolean;
  algorithm: string;
  iv: string;
  ciphertext: string;
  mimeType: string;
  sizeBytes: number;
  fileName?: string;
}
