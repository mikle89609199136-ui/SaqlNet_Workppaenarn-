import { disconnectRealtimeSocket, queryClient } from '@/shared/api';
import { forgetEncryptionStates, forgetSecurityNotices } from '@/shared/crypto';
import { clearMediaObjectUrls } from '@/entities/media/model/mediaObjectUrls';
import { services } from '@/services/serviceContainer';
import { clearAllDrafts, useChatUiStore } from '@/entities/chat';
import { clearOutbox } from '@/entities/message';
import { useProfileStore } from '@/entities/user';

export function clearAuthSession() {
  const { token, clearProfile } = useProfileStore.getState();
  if (!token) return;
  disconnectRealtimeSocket();
  // В кеше запросов лежат расшифрованные сообщения. Без очистки они
  // остались бы в памяти вкладки и достались следующему, кто здесь войдёт.
  queryClient.clear();
  // Расшифрованные файлы живут отдельно от кеша запросов: очистка кеша
  // убирает ссылки на них, но саму память браузер держит до отзыва.
  clearMediaObjectUrls();
  // Недописанные сообщения — тоже открытый текст, и они не должны
  // достаться следующему, кто войдёт в этой вкладке.
  clearAllDrafts();
  // Очередь исходящих сообщений и временные Blob URL также очищаются.
  clearOutbox();
  // Показанные переводы — тоже открытый текст. Они сбрасываются при смене
  // чата, но не при выходе: страница треда размонтируется, а chatId при
  // этом не меняется, поэтому сброс не срабатывает.
  useChatUiStore.getState().resetChatState();
  // Ключи с устройства не стираются: на своём компьютере повторный вход не
  // должен выглядеть для собеседников как вход с нового устройства. Стирает
  // их «завершить все сеансы».
  services.cryptoService.forgetSession();
  forgetEncryptionStates();
  forgetSecurityNotices();
  clearProfile();
}
