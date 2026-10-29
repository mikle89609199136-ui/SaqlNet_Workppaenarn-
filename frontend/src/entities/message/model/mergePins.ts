import type { IPinnedDto } from './types';

/** A message can be pinned in both scopes, but appears only once in the panel. */
export function mergePins(shared: IPinnedDto[], personal: IPinnedDto[]): IPinnedDto[] {
  const result = new Map<string, IPinnedDto>();
  for (const pin of shared)
    result.set(pin.messageId, {
      ...pin,
      message: { ...pin.message, isPinned: true, isChatPinned: true, isPersonalPinned: false },
    });
  for (const pin of personal) {
    const common = result.get(pin.messageId);
    const isChatPinned = Boolean(common);
    result.set(pin.messageId, {
      ...pin,
      message: { ...pin.message, isPinned: isChatPinned, isChatPinned, isPersonalPinned: true },
    });
  }
  return [...result.values()];
}
