import { createAlertPresence } from '@/shared/lib/notifications/alertPresence';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { queryClient, useRealtimeSocket } from '@/shared/api';
import { decryptChatLastMessagePreview } from '@/services/decryptChatPreview';
import {
  getNotificationFlags,
  refreshNotificationSettings,
  useProfileStore,
} from '@/entities/user';
import { chatKeys, chatQuery, isChatMuted } from '@/entities/chat';
import { useCallStore } from '@/features/call';
import { usePushNotifications, usePushStore } from '@/features/push-notifications';
import type { IChatDto, ILastMessageDto } from '@/types';
import { describeCallMessage, formatCallPreview, usePageActive } from '@/shared/lib';
import {
  appIsForeground,
  activeChatIs,
  browserAlertsAllowed,
} from '@/shared/lib/notifications/delivery';
import { claimAlert } from '@/shared/lib/notifications/claimAlert';
import { playMessageSound, stopMessageSound } from '@/shared/lib/notifications/messageSound';
import { useCallback, useEffect, useRef } from 'react';

const fallbackBody = (t: TFunction) => t('notification.newMessage', 'Новое сообщение');
const MAX_BODY_LENGTH = 120;

function isNavigateRequest(data: unknown): data is { type: 'craneapp:navigate'; url: string } {
  const message = data as { type?: unknown; url?: unknown } | null;
  return (
    message?.type === 'craneapp:navigate' &&
    typeof message.url === 'string' &&
    message.url.startsWith('/') &&
    !message.url.startsWith('//')
  );
}
function navigate(url: string) {
  window.history.pushState(null, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
function sameOwner(ownerId: string): boolean {
  const profile = useProfileStore.getState();
  return profile.isAuth && profile.user?.id === ownerId;
}
function chatMutePending(chatId: string): boolean {
  return queryClient
    .getMutationCache()
    .getAll()
    .some((mutation) => {
      const variables = mutation.state.variables as { chat?: IChatDto } | undefined;
      return (
        mutation.state.status === 'pending' &&
        mutation.options.mutationKey?.[1] === 'mute' &&
        variables?.chat?.id === chatId
      );
    });
}
function chatPreviewPending(chatId: string): boolean {
  return queryClient
    .getMutationCache()
    .getAll()
    .some(
      (mutation) =>
        mutation.state.status === 'pending' &&
        mutation.options.mutationKey?.[1] === 'notification-preview' &&
        (mutation.state.variables as IChatDto | undefined)?.id === chatId
    );
}
function chatAllowsMessage(chat: IChatDto): boolean {
  const cached = queryClient.getQueryData<IChatDto>(chatKeys.detail(chat.id));
  return (
    !chatMutePending(chat.id) &&
    !isChatMuted(chat) &&
    !isChatMuted(cached) &&
    !chat.isPeerBlocked &&
    !chat.isBlockedByPeer &&
    chat.type !== 'self'
  );
}

/** Permission спрашивается только существующим UI #882, никогда обработчиком события. */
export function NotificationManager() {
  const { t } = useTranslation();
  const signedIn = useProfileStore((state) => state.isAuth);
  const ownerId = useProfileStore((state) => state.user?.id);
  const { eventBus } = useRealtimeSocket(signedIn);
  usePushNotifications(signedIn);
  const incoming = useCallStore((state) => state.incomingCall);
  const alertsReady = useCallStore((state) => state.incomingAlertsReady);
  const foreground = usePageActive();
  const opened = useRef(new Map<string, () => void>());

  const openNotification = useCallback(
    async (
      owner: string,
      title: string,
      body: string,
      chatId: string,
      tag: string,
      silent: boolean,
      stillAllowed: () => boolean
    ) => {
      const canShow = () =>
        sameOwner(owner) &&
        getNotificationFlags(queryClient).notifications &&
        !appIsForeground() &&
        browserAlertsAllowed() &&
        stillAllowed() &&
        !(document.hidden && usePushStore.getState().status === 'on');
      if (!canShow()) return;
      const url = `/chats/${encodeURIComponent(chatId)}`;
      const options = {
        body,
        icon: '/icons/icon-192.png',
        tag,
        silent,
        renotify: !silent,
        data: { url },
      };
      try {
        const registration = await navigator.serviceWorker?.getRegistration?.('/');
        if (!canShow()) return;
        if (registration?.showNotification) {
          await registration.showNotification(title, options);
          opened.current.set(tag, () => {
            void registration
              .getNotifications({ tag })
              .then((notifications) =>
                notifications.forEach((notification) => notification.close())
              )
              .catch(() => {});
          });
          if (!canShow()) opened.current.get(tag)?.();
        } else {
          const notification = new Notification(title, options);
          notification.onclick = () => {
            notification.close?.();
            window.focus();
            navigate(url);
          };
          opened.current.get(tag)?.();
          opened.current.set(tag, () => notification.close?.());
        }
      } catch {
        /* ОС/браузер могут отклонить показ; не обходим отказ отдельным звуком. */
      }
    },
    []
  );

  // Настройки, полученные refetch/rollback, применяются также к уже запущенным эффектам.
  useEffect(() => {
    const closeAll = () => {
      for (const close of opened.current.values()) close();
      opened.current.clear();
      stopMessageSound();
    };
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      const flags = getNotificationFlags(queryClient);
      if (!flags.notifications) closeAll();
      else if (!flags.sounds) stopMessageSound();
    });
    if (!signedIn) closeAll();
    return () => {
      unsubscribe();
      closeAll();
    };
  }, [signedIn, ownerId]);

  useEffect(() => {
    const container = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
    if (!container) return;
    const onMessage = (event: MessageEvent) => {
      if (isNavigateRequest(event.data)) navigate(event.data.url);
    };
    container.addEventListener('message', onMessage);
    return () => container.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    let active = true;
    const presence = createAlertPresence(ownerId ?? '', () =>
      Boolean(ownerId && sameOwner(ownerId))
    );
    const allowed = (owner: string) =>
      active && sameOwner(owner) && getNotificationFlags(queryClient).notifications;
    const unsubscribe = eventBus.on('new_message', (payload) => {
      if (!signedIn || !ownerId || !sameOwner(ownerId)) return;
      const message = (payload?.message ?? payload ?? {}) as ILastMessageDto & { chatId?: string };
      const chatId = message.chatId ?? payload?.chatId;
      if (typeof chatId !== 'string' || !chatId || typeof message.id !== 'string' || !message.id)
        return;
      if (message.senderId === ownerId) return;
      const callInfo =
        message.type === 'call'
          ? describeCallMessage(message.content, message.senderId, ownerId)
          : null;
      if (callInfo && (callInfo.answered || callInfo.direction !== 'incoming')) return;
      const deliver = async () => {
        if (!appIsForeground() && (await presence.hasForegroundPeer())) return;
        await claimAlert(ownerId, `message:${message.id}`, async () => {
          if (!active || !sameOwner(ownerId)) return;
          if (document.hidden && usePushStore.getState().status === 'on') return;
          if (appIsForeground() && activeChatIs(chatId)) return;
          if (!(await refreshNotificationSettings(queryClient)) || !allowed(ownerId)) return;
          try {
            if (!callInfo && chatMutePending(chatId)) return;
            let chat = await queryClient.fetchQuery({
              ...chatQuery(chatId),
              staleTime: 0,
              retry: false,
            });
            const permitted = (current: IChatDto) =>
              callInfo
                ? !current.isPeerBlocked && !current.isBlockedByPeer && current.type !== 'self'
                : chatAllowsMessage(current);
            if (!permitted(chat) || !allowed(ownerId)) return;
            const flags = getNotificationFlags(queryClient);
            // Только звук другого чата на переднем плане; Notification permission его не включает.
            if (appIsForeground()) {
              if (!callInfo && flags.sounds && !activeChatIs(chatId)) {
                void playMessageSound(
                  () =>
                    allowed(ownerId) &&
                    getNotificationFlags(queryClient).sounds &&
                    appIsForeground() &&
                    !activeChatIs(chatId) &&
                    chatAllowsMessage(chat)
                );
              }
              return;
            }
            if (!browserAlertsAllowed()) return;
            let body = callInfo
              ? formatCallPreview(message.content, t, {
                  senderId: message.senderId,
                  viewerId: ownerId,
                })
              : fallbackBody(t);
            if (
              !callInfo &&
              !chat.hideNotificationPreview &&
              !chatPreviewPending(chatId) &&
              typeof message.content === 'string' &&
              message.content
            ) {
              const decrypted = await decryptChatLastMessagePreview(chatId, message);
              const text = decrypted?.content;
              if (
                typeof text === 'string' &&
                text &&
                !decrypted.undecryptable &&
                !text.startsWith('{')
              )
                body = text.slice(0, MAX_BODY_LENGTH);
            }
            // Последняя проверка после ключей/decrypt: preview и mute могли измениться на другом устройстве.
            chat = await queryClient.fetchQuery({
              ...chatQuery(chatId),
              staleTime: 0,
              retry: false,
            });
            if (!permitted(chat) || !allowed(ownerId)) return;
            if (
              !callInfo &&
              (chat.hideNotificationPreview ||
                chatPreviewPending(chatId) ||
                queryClient.getQueryData<IChatDto>(chatKeys.detail(chatId))
                  ?.hideNotificationPreview)
            )
              body = fallbackBody(t);
            const silent = Boolean(callInfo) || !getNotificationFlags(queryClient).sounds;
            await openNotification(
              ownerId,
              message.senderName || 'CraneApp',
              body,
              chatId,
              `chat:${chatId}`,
              silent,
              () => active && permitted(chat)
            );
          } catch {
            /* Не удалось проверить mute/preview: новое оповещение не разрешается. */
          }
        });
      };
      void deliver().catch(() => {});
    });

    return () => {
      active = false;
      presence.dispose();
      unsubscribe();
    };
  }, [eventBus, signedIn, ownerId, t, openNotification]);

  useEffect(() => {
    let active = true;
    const presence = createAlertPresence(ownerId ?? '', () =>
      Boolean(ownerId && sameOwner(ownerId))
    );
    const allowed = (owner: string) =>
      active && sameOwner(owner) && getNotificationFlags(queryClient).notifications;
    // Только валидированный FSM incoming: raw call_incoming ещё не прошёл room/privacy/block checks.
    let closeCall: (() => void) | undefined;
    if (signedIn && ownerId && incoming && alertsReady && incoming.chatId && !foreground) {
      const roomId = incoming.roomId;
      const tag = `call:${roomId}`;
      const stillIncoming = () => active && useCallStore.getState().incomingCall?.roomId === roomId;
      const notifyCall = async () => {
        if (await presence.hasForegroundPeer()) return;
        await claimAlert(ownerId, `call:${roomId}`, async () => {
          if (!allowed(ownerId) || !stillIncoming()) return;
          await openNotification(
            ownerId,
            incoming.fromName || 'CraneApp',
            incoming.kind === 'video'
              ? t('call.incomingVideo', 'Входящий видеозвонок')
              : t('call.incoming', 'Входящий звонок'),
            incoming.chatId!,
            tag,
            !getNotificationFlags(queryClient).callSounds,
            stillIncoming
          );
          closeCall = () => {
            opened.current.get(tag)?.();
            opened.current.delete(tag);
          };
          if (!active || !stillIncoming()) closeCall();
        });
      };
      void notifyCall().catch(() => {});
    }
    return () => {
      active = false;
      presence.dispose();
      closeCall?.();
    };
  }, [signedIn, ownerId, incoming, alertsReady, foreground, t, openNotification]);

  return null;
}
