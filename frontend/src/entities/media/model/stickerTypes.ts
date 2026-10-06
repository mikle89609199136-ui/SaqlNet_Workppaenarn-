export interface IStickerPack {
  id: string;
  name: string;
  description: string;
  iconUrl: string;
  stickerCount: number;
  createdAt: string;
}

export interface ISticker {
  id: string;
  imageUrl: string;
  createdAt: string;
}
