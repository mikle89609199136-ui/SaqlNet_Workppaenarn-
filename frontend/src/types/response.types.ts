import type { IChatDto, TChatsList, TMembersList } from './chat.types';
import type {
  IMessageDto,
  TEmojisList,
  TMessagesList,
  TPinnedList,
  TReactionsList,
} from './message.types';
import type { IUserDto, TSearchUsersList } from './user.types';

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

export interface IUploadResponse {
  url?: string;
  [key: string]: unknown;
}
export interface IMessageApiResponse {
  message?: IMessageDto;
  [key: string]: unknown;
}

export interface IEmojisResponse {
  reactions: TEmojisList;
}

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
