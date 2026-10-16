import type { ILastMessageDto } from './types';

type TDecryptPreview = (chatId: string, lastMessage: ILastMessageDto) => Promise<ILastMessageDto>;
type TDecryptedPart = Pick<ILastMessageDto, 'content' | 'entities'>;

const MAX_PREVIEWS = 500;
const decrypted = new Map<string, TDecryptedPart>();

const previewKey = (chatId: string, { id, content }: ILastMessageDto) =>
  `${chatId}:${id}:${content}`;

function remember(key: string, part: TDecryptedPart) {
  decrypted.set(key, part);
  if (decrypted.size > MAX_PREVIEWS) decrypted.delete(decrypted.keys().next().value!);
}

export async function decryptPreviewOnce(
  chatId: string,
  lastMessage: ILastMessageDto,
  decrypt: TDecryptPreview
): Promise<ILastMessageDto> {
  const key = previewKey(chatId, lastMessage);
  const known = decrypted.get(key);
  if (known) return { ...lastMessage, ...known };

  const preview = await decrypt(chatId, lastMessage);
  if (preview !== lastMessage && !preview.undecryptable) {
    remember(key, { content: preview.content, entities: preview.entities });
  }
  return preview;
}

export function forgetDecryptedPreviews(): void {
  decrypted.clear();
}
