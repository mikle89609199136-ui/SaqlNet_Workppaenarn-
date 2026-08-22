import type { TChatType } from "@/types";

export type TCallKind = "audio" | "video";
export type TCallRoomType = TChatType;

export interface ICall {
	roomId: string;
	from: string;
}

export interface IIncomingCall extends ICall {
	fromName?: string;
	fromAvatar?: string | null;
	kind: TCallKind;
	title?: string;
	callType?: TCallRoomType;
}

export interface IActiveCall {
	roomId: string;
	type: TCallRoomType;
	kind: TCallKind;
	title?: string;
	chatId?: string;
}

export interface IRingtone {
	ctx: AudioContext;
	ringtoneTimer: ReturnType<typeof setInterval>;
	vibrateTimer: ReturnType<typeof setInterval> | null;
}

export interface ICallInviteResponsePayload {
	roomId: string;
	accepted: boolean;
	reason?: string;
}

export interface ICallCancelledPayload {
	roomId: string;
}