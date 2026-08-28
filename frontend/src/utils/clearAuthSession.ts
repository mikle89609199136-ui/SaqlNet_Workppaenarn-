import { disconnectRealtimeSocket } from '@/hooks/useRealtimeSocket';
import { forgetEncryptionStates } from '@/crypto/encryptionStatus';
import { forgetSecurityNotices } from '@/crypto/securityNotices';
import { clearMediaObjectUrls } from '@/services/mediaObjectUrls';
import { services } from '@/services/serviceContainer';
import { clearAllDrafts } from '@/store/chatDrafts';
import { useChatUiStore } from '@/store/chatUi';
import { queryClient } from '@/queries/queryClient';
import { useProfileStore } from '@/store/profile';

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
