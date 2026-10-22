import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import '../../src/app/styles/tailwind.css';
import { ChatListItem } from '@/entities/chat/ui/ChatListItem/ChatListItem';
import { MessagesList } from '@/widgets/chat-messages/ui/MessagesList';
import { ComposerRow } from '@/widgets/chat-composer/ui/ComposerRow';
import {
  userKeys,
  useProfileStore,
  useApplyPreferences,
  normalizePreferences,
} from '@/entities/user';
import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { makeChat, makeMessage, makeUser } from '@/test/fixtures';
import type { ISettingsDto } from '@/types';

const previewI18n = createInstance();
await previewI18n.use(initReactI18next).init({
  lng: 'ru',
  keySeparator: false,
  resources: { ru: { translation: await (await fetch('/locales/ru/translation.json')).json() } },
  interpolation: { escapeValue: false },
});
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const params = Object.fromEntries(new URLSearchParams(location.search));
const hidden = params.hidden === 'true';
useProfileStore.setState({ user: makeUser({ id: 'me' }), isAuth: true });
queryClient.setQueryData(userKeys.settings(), {
  settings: normalizePreferences({
    ...(params as Partial<ISettingsDto>),
    showMessageTime: !hidden,
    showMessageStatus: !hidden,
    showMessageAvatars: !hidden,
    groupConsecutiveMessages: !hidden,
  }),
  privacy: {},
});
const messages = [
  makeMessage({
    id: 'one',
    senderId: 'anna',
    senderName: 'Анна',
    content: 'Проверяем настройки оформления в группе.',
    createdAt: new Date('2026-10-22T10:00:00Z'),
  }),
  makeMessage({
    id: 'two',
    senderId: 'anna',
    senderName: 'Анна',
    content:
      'Длинное сообщение с переносом строки и ссылкой https://example.com/very/long/path/to/resource.',
    createdAt: new Date('2026-10-22T10:01:00Z'),
  }),
  makeMessage({
    id: 'three',
    senderId: 'me',
    content: 'Прочитанное сообщение',
    status: 'read',
    createdAt: new Date('2026-10-22T10:02:00Z'),
  }),
  makeMessage({
    id: 'four',
    senderId: 'me',
    content: 'Ошибка отправки должна оставаться видимой',
    status: 'failed',
    createdAt: new Date('2026-10-22T10:03:00Z'),
  }),
];
function Preview() {
  useApplyPreferences();
  return (
    <main className="flex h-screen bg-ground text-ink">
      <aside className="hidden w-64 shrink-0 bg-sheet p-3 md:block">
        <ChatListItem
          chat={makeChat({ id: 'example', title: 'Анна', lastMessage: messages[0] })}
          currentUserId="me"
        />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col bg-chat-bg">
        <header className="bg-sheet p-4 text-subtitle">Настройки оформления · группа</header>
        <MessagesList
          messages={messages}
          isLoading={false}
          error=""
          isGroupChat
          trackUnread={false}
          setOpenedImage={() => {}}
          toggleMessageSelection={() => {}}
          onReact={() => {}}
          onRetryMessage={() => {}}
          showDeliveryStatus
        />
        <footer className="bg-composer">
          <ComposerRow>
            <div className="min-h-10 flex-1 p-2 text-body">Сообщение…</div>
          </ComposerRow>
        </footer>
      </div>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <I18nextProvider i18n={previewI18n}>
      <MemoryRouter>
        <Preview />
      </MemoryRouter>
    </I18nextProvider>
  </QueryClientProvider>
);
