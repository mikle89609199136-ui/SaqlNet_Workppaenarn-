import { WS_EVENTS } from '@/consts';
import { services } from '@/services';
import { useChatsStore, useProfileStore } from '@/store';
import type {
  IChatDto,
  ILastMessageDto,
  IMessageDeletedEvent,
  IMessageDto,
  IMessageEditedEvent,
  IMessageNewEvent,
  ITypingEvent,
} from '@/types';
import { decryptChatLastMessagePreview } from '@/utils';
import { useEffect, useRef } from 'react';
import { useRealtimeSocket } from './useRealtimeSocket';

const extractLastMessage = (message: IMessageDto): ILastMessageDto => {
  return {
    id: message.id,
    content: message.content,
    type: message.type,
    senderId: message.senderId,
    senderName: message.senderName,
    reactions: message.reactions || [],
  };
};

export const useChatLastMessagePreview = () => {
  const setChats = useChatsStore((state) => state.setChats);
  const typingTimeoutsRef = useRef(new Map());
  const { eventBus } = useRealtimeSocket();
  const currentUser = useProfileStore((state) => state.user);

  useEffect(() => {
    const clearTypingTimeout = (chatId: string) => {
      clearTimeout(typingTimeoutsRef.current.get(chatId));
      typingTimeoutsRef.current.delete(chatId);
    };

    const updateNewLastMessagePreview = async (event: IMessageNewEvent) => {
      const lastMessage = await decryptChatLastMessagePreview(
        event.chatId,
        extractLastMessage(event.message)
      );

      const processedMessage = await services.messageService.processMessageForDisplay(
        event.chatId,
        event.message
      );
      services.messageService.addMessageToCache(event.chatId, processedMessage);
      setChats((items) => {
        const index = items.findIndex((chat) => chat.id === event.chatId);
        if (index === -1) return items;

        const nextChat = {
          ...items[index],
          typingUserId: null,
          lastMessage: lastMessage,
          lastMessageAt: event.message.createdAt,
        };
        clearTimeout(typingTimeoutsRef.current.get(event.chatId));
        typingTimeoutsRef.current.delete(event.chatId);
        const nextItems = [nextChat, ...items.slice(0, index), ...items.slice(index + 1)];
        return nextItems;
      });
    };

    const showPrevLastMessageAfterDeletionCurrent = async (event: IMessageDeletedEvent) => {
      if (!event.chatId) return;
      if (event.previousMessage === null) {
        setChats((items) => {
          const index = items.findIndex((chat) => chat.id === event.chatId);
          if (index === -1) return items;

          const chat = items[index];

          if (chat.lastMessage?.id !== event.messageId) return items;

          const nextChat: IChatDto = {
            ...chat,
            lastMessage: undefined,
          };
          clearTimeout(typingTimeoutsRef.current.get(event.chatId));
          typingTimeoutsRef.current.delete(event.chatId);
          const nextItems = [nextChat, ...items.slice(0, index), ...items.slice(index + 1)];
          return nextItems;
        });
        return;
      }

      const processedMessage = await services.messageService.processLastMessageForDisplay(
        event.chatId,
        extractLastMessage(event.previousMessage)
      );

      setChats((items) => {
        const index = items.findIndex((chat) => chat.id === event.chatId);
        if (index === -1) return items;

        const chat = items[index];

        if (chat.lastMessage?.id !== event.messageId || !event.previousMessage) return items;

        const nextChat = {
          ...chat,
          typingUserId: null,
          lastMessage: processedMessage,
          lastMessageAt: event.previousMessage.createdAt,
        };
        clearTimeout(typingTimeoutsRef.current.get(event.chatId));
        typingTimeoutsRef.current.delete(event.chatId);
        const nextItems = [nextChat, ...items.slice(0, index), ...items.slice(index + 1)];
        return nextItems;
      });
    };

    const updateEditedLastMessagePreview = async (event: IMessageEditedEvent) => {
      if (!event.chatId || !event.messageId) return;

      const chat = useChatsStore.getState().chats.find((c) => c.id === event.chatId);
      if (!chat || chat.lastMessage?.id !== event.messageId) return;

      const lastMessage = await decryptChatLastMessagePreview(event.chatId, {
        ...chat.lastMessage,
        content: event.content,
      });

      setChats((items) =>
        items.map((c) =>
          c.id === event.chatId && c.lastMessage?.id === event.messageId ? { ...c, lastMessage } : c
        )
      );
    };

    const handleTyping = (event: ITypingEvent) => {
      const chatId = event.chatId;
      const userId = event.userId || event.senderId;
      if (!chatId || !userId || userId === currentUser?.id) return;

      setChats((items) =>
        items.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                typingUserId: userId,
              }
            : chat
        )
      );

      clearTypingTimeout(chatId);
      typingTimeoutsRef.current.set(
        chatId,
        setTimeout(() => {
          setChats((items) =>
            items.map((chat) => (chat.id === chatId ? { ...chat, typingUserId: null } : chat))
          );
          typingTimeoutsRef.current.delete(chatId);
        }, 3000)
      );
    };

    const unsubscribeNewMessage = eventBus.on(WS_EVENTS.MESSAGE.NEW, updateNewLastMessagePreview);
    const unsubscribeSentMessageLocal = eventBus.on(
      WS_EVENTS.MESSAGE.LOCAL.SENT,
      updateNewLastMessagePreview
    );
    const unsubscribeLastMessageEditedLocal = eventBus.on(
      WS_EVENTS.MESSAGE.LOCAL.EDITED,
      updateEditedLastMessagePreview
    );
    const unsubscribeMessageEdited = eventBus.on(
      WS_EVENTS.MESSAGE.EDITED,
      updateEditedLastMessagePreview
    );
    const unsubscribeMessageDeleted = eventBus.on(
      WS_EVENTS.MESSAGE.DELETED,
      showPrevLastMessageAfterDeletionCurrent
    );
    const unsubscribeMessageDeletedLocal = eventBus.on(
      WS_EVENTS.MESSAGE.LOCAL.DELETED,
      showPrevLastMessageAfterDeletionCurrent
    );
    const unsubscribeUserTyping = eventBus.on(WS_EVENTS.USER.TYPING, handleTyping);
    const unsubscribeMessagesRead = eventBus.on(WS_EVENTS.MESSAGE.LOCAL.READ, ({ chatId }) => {
      setChats((items) =>
        items.map((chat) => (chat.id === chatId ? { ...chat, unreadCount: 0 } : chat))
      );
    });

    return () => {
      unsubscribeNewMessage();
      unsubscribeSentMessageLocal();
      unsubscribeMessageEdited();
      unsubscribeLastMessageEditedLocal();
      unsubscribeMessageDeleted();
      unsubscribeMessageDeletedLocal();
      unsubscribeUserTyping();
      unsubscribeMessagesRead();
      typingTimeoutsRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
      typingTimeoutsRef.current.clear();
    };
  }, [currentUser?.id, eventBus]);
};
