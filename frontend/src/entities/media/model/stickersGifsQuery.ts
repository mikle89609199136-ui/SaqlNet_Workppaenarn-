import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { services } from '@/services/serviceContainer';
import { mediaKeys } from './mediaKeys';
import type { ISticker, IStickerPack } from './stickerTypes';
import type { IGif } from './gifTypes';

export function stickerPacksQuery() {
  return queryOptions<IStickerPack[]>({
    queryKey: mediaKeys.stickerPacks(),
    queryFn: () => services.mediaService.listStickerPacks(),
    staleTime: 5 * 60 * 1000,
  });
}

export function stickersQuery(packId: string) {
  return queryOptions<ISticker[]>({
    queryKey: mediaKeys.stickers(packId),
    queryFn: () => services.mediaService.listStickers(packId),
    staleTime: 10 * 60 * 1000,
    enabled: Boolean(packId),
  });
}

export function gifsQuery() {
  return queryOptions<IGif[]>({
    queryKey: mediaKeys.gifs(),
    queryFn: () => services.mediaService.listGifs(),
    staleTime: 5 * 60 * 1000,
  });
}

export function favoriteGifsQuery() {
  return queryOptions<IGif[]>({
    queryKey: mediaKeys.favoriteGifs(),
    queryFn: () => services.mediaService.listFavoriteGifs(),
    staleTime: 60 * 1000,
  });
}

export function useStickerPacksQuery() {
  return useQuery(stickerPacksQuery());
}

export function useStickersQuery(packId: string) {
  return useQuery(stickersQuery(packId));
}

export function useGifsQuery() {
  return useQuery(gifsQuery());
}

export function useFavoriteGifsQuery() {
  return useQuery(favoriteGifsQuery());
}

export function useToggleFavoriteGifMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ gifId, isFavorite }: { gifId: string; isFavorite: boolean }) => {
      if (isFavorite) {
        await services.mediaService.unfavoriteGif(gifId);
      } else {
        await services.mediaService.favoriteGif(gifId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: mediaKeys.favoriteGifs() });
    },
  });
}
