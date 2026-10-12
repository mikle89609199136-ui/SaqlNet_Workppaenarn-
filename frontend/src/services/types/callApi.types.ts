export type TCallKind = 'audio' | 'video';
export type TCallRoomType = 'direct' | 'group' | 'channel' | 'p2p' | 'private';

export interface IIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface ICallParticipant {
  userId: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface ICallRoom {
  id: string;
  type: 'p2p' | 'group';
  callKind: TCallKind;
  chatId: string;
  title: string;
  hostId: string;
  participants?: ICallParticipant[];
}

export interface ICallRoomCreateRequest {
  chatId: string;
  type?: 'p2p' | 'group';
  title?: string;
  callKind?: TCallKind;
}

export interface ICallRoomResponse {
  success: boolean;
  room: ICallRoom;
  iceServers: IIceServer[];
  maxParticipants: number;
}

export interface IIceConfiguration {
  servers?: IIceServer[];
  iceServers?: IIceServer[];
  hasTurn?: boolean;
  meteredConfigured?: boolean;
  meteredTest?: unknown;
}

export type TCallDirection = 'incoming' | 'outgoing';
export type TCallStatus = 'answered' | 'missed' | 'rejected' | 'cancelled';

export interface ICallHistoryItemDto {
  id: string;
  roomId: string;
  chatId?: string;
  peerId: string;
  peerName?: string;
  peerAvatar?: string | null;
  direction: TCallDirection;
  kind: TCallKind;
  status: TCallStatus;
  startedAt: string;
  endedAt?: string | null;
  durationSeconds: number;
}

export interface ICallHistoryParams {
  cursor?: string;
  limit?: number;
  kind?: TCallKind;
  status?: TCallStatus;
}

export interface ICallHistoryResponse {
  calls: ICallHistoryItemDto[];
  nextCursor?: string | null;
  hasMore: boolean;
}
