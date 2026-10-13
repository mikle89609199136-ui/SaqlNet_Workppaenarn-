export const mediaKeys = {
  all: ['media'] as const,
  stickerPacks: () => [...mediaKeys.all, 'sticker-packs'] as const,
  stickers: (packId: string) => [...mediaKeys.all, 'stickers', packId] as const,
  gifs: () => [...mediaKeys.all, 'gifs'] as const,
  favoriteGifs: () => [...mediaKeys.all, 'favorite-gifs'] as const,
};
