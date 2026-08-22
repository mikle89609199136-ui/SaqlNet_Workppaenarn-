import type { IChatDto, TChatsList, TMembersList } from './chat.types';
import type {
  IMessageDto,
  TEmojisList,
  TMessagesList,
  TPinnedList,
  TReactionsList,
} from './message.types';
import type { TSearchUsersList } from './user.types';

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
