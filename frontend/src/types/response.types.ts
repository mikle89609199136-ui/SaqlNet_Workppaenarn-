import type { components } from './api.generated';
import type { IChatDto, TChatsList, TMembersList } from '@/entities/chat';
import type { IMessageDto, TMessagesList, TPinnedList, TReactionsList } from '@/entities/message';
import type { IUserDto, TSearchUsersList } from '@/entities/user';

/**
 * Ответ входа и регистрации.
 *
 * `twoFARequired` приходит со статусом 200, а не с ошибкой: сервер
 * сообщает, что пары логин-пароль мало, и ждёт второй запрос
 * (`auth/handler.go:87`). Токена в таком ответе нет.
 */
export interface IAuthResponse {
  token?: string;
  user?: IUserDto;
  twoFARequired?: boolean;
  userId?: string;
}

export interface ISuccessResponse {
  success: boolean;
}

export interface ICreateGroupChatResponse {
  chatId: string;
  title: string;
}

export interface IMlsStateResponse {
  state: any;
}

export interface IDeleteMessageResponse extends ISuccessResponse {
  lastMessage: IMessageDto | null;
}

export interface IReactionsResponse {
  reactions: TReactionsList;
}

export interface IMessageResponse {
  message: IMessageDto;
}

export interface IMessagesResponse {
  messages: TMessagesList;
}

export type IUploadResponse = components['schemas']['UploadResponse'];
export interface IMessageApiResponse {
  message?: IMessageDto;
  [key: string]: unknown;
}

export type IEmojisResponse = components['schemas']['MediaEmojisResponse'];

export interface IPinnedListResponse {
  pins: TPinnedList;
}

export interface IChatResponse {
  chat: IChatDto;
}

export interface IChatsResponse {
  chats: TChatsList;
}

export interface IMembersListResponse {
  members: TMembersList;
}

export interface ISearchUsersResponse {
  users: TSearchUsersList;
}
