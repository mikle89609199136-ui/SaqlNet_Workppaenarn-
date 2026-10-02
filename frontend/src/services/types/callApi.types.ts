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
