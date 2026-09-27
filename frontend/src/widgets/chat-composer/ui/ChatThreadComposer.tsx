import { useEncryptionState } from '@/features/chat-encryption';
import { PendingForwardBanner, useForwardSend } from '@/features/forward-messages';
import { useTypingIndicator } from '@/features/typing-indicator';
import {
  useSendVoiceMessage,
  useVoiceErrorToast,
  useVoiceRecorder,
  VoiceButton,
} from '@/features/voice-message';
import {
  useAttachmentPicker,
  useComposerSendMessage,
  useComposerShortcuts,
} from '@/features/send-message';
import {
  chatQuery,
  clearDraft,
  readDraft,
  readRichDraft,
  useChatUiStore,
  writeDraft,
} from '@/entities/chat';
import { useQuery } from '@tanstack/react-query';
import type { IEncryptionState } from '@/shared/crypto';
import type { TFunction } from 'i18next';
import type { IPendingAttachment } from '@/types';
import { cn } from '@/shared/lib';
import type { IRichText } from '@/shared/lib/richText';
import { Button, Icon, RichTextInput, type IRichTextInputHandle } from '@/shared/ui';
import {
  useEffect,
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
  type SubmitEvent,
} from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AttachmentControl } from './AttachmentControl';
import { EmojiControl } from './EmojiControl';
import { EncryptionUnavailableComposer } from './EncryptionUnavailableComposer';
import { AttachmentPreview } from './AttachmentPreview';
import { BlockedComposer } from './BlockedComposer';
import { ComposerContextBanner } from './ComposerContextBanner';
import { ComposerForm } from './ComposerForm';
import { ComposerRow } from './ComposerRow';
import { VoiceRecordingBar } from './VoiceRecordingBar';

/** Что написано в поле ввода, пока сообщение не набрано. */
function composerPlaceholder(
  encryption: IEncryptionState,
  t: TFunction,
  hasAttachment: boolean
): string {
  if (encryption.status === 'preparing') {
    return t('encryptionPreparing', 'Готовим шифрование...');
  }

  if (encryption.status === 'unavailable') {
    return t('encryptionUnavailable', 'Шифрование недоступно');
  }

  if (encryption.unreachable.length > 0) {
    return t('peerNeedsUpdate', 'Собеседник прочтёт после обновления приложения');
  }

  // С вложением текст — подпись к нему, как в макете.
  if (hasAttachment) return t('captionPlaceholder', 'Добавьте подпись');

  return t('messagePlaceholder', 'Сообщение');
}

interface Props {
  selectionMode: boolean;
  pendingAttachment: IPendingAttachment | null;
  bottomRef: RefObject<HTMLDivElement | null>;
  attachmentInputRef: RefObject<HTMLInputElement | null>;
  draftRef: RefObject<IRichTextInputHandle | null>;
  setPendingAttachment: Dispatch<SetStateAction<IPendingAttachment | null>>;
  setPhotoEditorFile: Dispatch<SetStateAction<File | null>>;
  setOpenedImage?: Dispatch<SetStateAction<string | null>>;
}

export const ChatThreadComposer = ({
  selectionMode,
  pendingAttachment,
  setPendingAttachment,
  bottomRef,
  attachmentInputRef,
  draftRef,
  setPhotoEditorFile,
  setOpenedImage,
}: Props) => {
  const { t } = useTranslation();

  const { chatId = '' } = useParams<{ chatId: string }>();

  // Пока ключ чата не готов, отправлять нечем: сообщение ушло бы открытым
  // текстом или не ушло вовсе, и человеку лучше узнать об этом до того,
  // как он его наберёт.
  const encryption = useEncryptionState(chatId);

  // Текст живёт в самом поле, а не в состоянии React: иначе каждый символ
  // перерисовывал бы композер со всеми его частями. Здесь хранится
  // единственное, от чего зависит вид, — есть ли что отправлять.
  const [hasText, setHasText] = useState(() => readDraft(chatId).length > 0);

  const formRef = useRef<HTMLFormElement | null>(null);

  /* Возврат в чат: поле заполняется тем, что осталось недописанным.

     Разделено надвое намеренно. Признак «в поле что-то есть» — состояние
     React, и обновляется сравнением во время отрисовки: эффект успел бы
     нарисовать кадр, где кнопка отправки уже активна от прежнего чата.
     А запись в само поле — работа с DOM, ей место в эффекте. */
  const [seenChatId, setSeenChatId] = useState(chatId);

  if (chatId !== seenChatId) {
    setSeenChatId(chatId);
    setHasText(readDraft(chatId).length > 0);
  }

  useEffect(() => {
    draftRef.current?.setValue(readRichDraft(chatId));
  }, [chatId, draftRef]);

  const sendTyping = useTypingIndicator();
  const { cancelComposerMode } = useComposerShortcuts(draftRef);
  const { handleAttachmentChange, removePendingAttachment } = useAttachmentPicker({
    attachmentInputRef,
    setPendingAttachment,
    setPhotoEditorFile,
  });
  const { handleSubmit, isSending } = useComposerSendMessage({
    attachmentInputRef,
    bottomRef,
    draftRef,
    pendingAttachment,
    selectionMode,
    setPendingAttachment,
  });
  const forward = useForwardSend(chatId);
  // Голосовые (#843): запись живёт, пока открыт этот чат.
  const voice = useVoiceRecorder(chatId);
  const sendVoice = useSendVoiceMessage(chatId);
  useVoiceErrorToast(voice.state);
  const [voiceCancelProgress, setVoiceCancelProgress] = useState(0);
  const editingMessage = useChatUiStore((state) => state.editingMessage);
  // Блокировка в личном чате (#760) — вместо поля ввода. Проверка после
  // всех хуков: их порядок не должен зависеть от данных.
  const { data: chat } = useQuery(chatQuery(chatId));

  /* Пересылка ждёт в этом чате: «Отправить» уносит комментарий из поля
     (если он есть) и пересланные сообщения, а не обычное сообщение. */
  async function handleComposerSubmit(event: SubmitEvent<HTMLFormElement>) {
    if (!forward.pending || selectionMode) {
      await handleSubmit(event);
      return;
    }

    event.preventDefault();
    const comment = draftRef.current?.getValue() ?? { text: '', entities: [] };
    draftRef.current?.clear();
    clearDraft(chatId);
    setHasText(false);

    const { commentSent } = await forward.send(comment);
    if (comment.text.trim() && !commentSent) {
      draftRef.current?.setValue(comment);
      writeDraft(chatId, comment);
      setHasText(true);
    }
  }

  function handleDraftChange(value: IRichText, { external }: { external: boolean }) {
    // Пустое поле — не черновик: пометка в списке чатов должна пропасть
    // сразу, а не через полсекунды после стирания последнего символа.
    if (value.text.trim()) writeDraft(chatId, value);
    else clearDraft(chatId);

    // Перерисовка только на переходе «пусто ↔ есть текст»: остальные
    // символы состояние не трогают.
    setHasText(value.text.trim().length > 0);
    // «Печатает» — только когда печатает человек, а не когда поле
    // заполнила программа (черновик, правка).
    if (!external) sendTyping();
  }

  const submitForm = useCallback(() => formRef.current?.requestSubmit(), []);
  const canSend = hasText || Boolean(forward.pending) || Boolean(pendingAttachment);
  const recordingVoice = voice.state.status !== 'idle';
  // Микрофон — когда отправлять нечего: пустое поле, без вложения, не
  // правка и не пересылка.
  const showMic = !canSend && !editingMessage && encryption.status === 'ready';

  if (chat?.type === 'private' && (chat.isBlockedByPeer || chat.isPeerBlocked)) {
    return <BlockedComposer chat={chat} />;
  }

  // Без ключа писать некуда — плашка с «Проверить» вместо поля (#826).
  if (encryption.status === 'unavailable') {
    return <EncryptionUnavailableComposer chatId={chatId} />;
  }

  return (
    <ComposerForm onSubmit={handleComposerSubmit} ref={formRef}>
      {forward.pending ? (
        <PendingForwardBanner forward={forward.pending} onCancel={forward.cancel} />
      ) : (
        <ComposerContextBanner onCancel={cancelComposerMode} />
      )}
      <AttachmentPreview
        attachment={pendingAttachment}
        onEdit={setPhotoEditorFile}
        onOpenImage={setOpenedImage ? (url) => setOpenedImage(url) : undefined}
        onRemove={removePendingAttachment}
      />
      <ComposerRow>
        {/* Идёт запись голосового — полоса записи вместо поля. Поле не
            размонтируется: скрыто, и его состояние остаётся на месте. */}
        {recordingVoice && (
          <VoiceRecordingBar
            cancelProgress={voiceCancelProgress}
            levels={voice.state.levels}
            locked={voice.state.status === 'locked' || voice.state.status === 'stopping'}
            onCancel={() => voice.recorder.cancel()}
            seconds={voice.state.elapsedMs / 1000}
          />
        )}
        <div className={cn('contents', recordingVoice && 'hidden')}>
          {/* К пересылке прикладывается только комментарий: вложение ушло бы
            отдельным сообщением неизвестно где в очереди. */}
          <AttachmentControl
            isSending={isSending || Boolean(forward.pending)}
            inputRef={attachmentInputRef}
            onChange={handleAttachmentChange}
          />

          {/* Поле: 40px в одну строку, растёт до ~7 строк (164px), текст
            15/22 — как в макете. */}
          <RichTextInput
            ariaLabel={t('message', 'Сообщение')}
            className="max-h-41 min-h-10 overflow-y-auto px-2 py-2.25 text-body leading-[22px] text-ink"
            disabled={encryption.status !== 'ready'}
            onChange={handleDraftChange}
            onSubmit={submitForm}
            placeholder={composerPlaceholder(encryption, t, Boolean(pendingAttachment))}
            ref={draftRef}
          />

          <EmojiControl disabled={encryption.status !== 'ready'} draftRef={draftRef} />
        </div>

        {/* Отправлять нечего — микрофон (#843); иначе «Отправить», залитая
            акцентом, когда есть что отправить. */}
        {showMic || recordingVoice ? (
          <VoiceButton
            onCancelProgress={setVoiceCancelProgress}
            onRecorded={sendVoice}
            recorder={voice.recorder}
            state={voice.state}
          />
        ) : (
          <Button
            aria-label={t('sendMessage', 'Отправить сообщение')}
            className={cn(!canSend && 'text-ink-3')}
            disabled={encryption.status !== 'ready' || forward.isForwarding}
            iconOnly
            type="submit"
            variant={canSend ? 'primary' : 'ghost'}
          >
            <Icon className="size-4.75 stroke-2" name="send" />
          </Button>
        )}
      </ComposerRow>
    </ComposerForm>
  );
};
