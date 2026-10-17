import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ICallHistoryItemDto } from '@/services/types/callApi.types';
import { testI18n } from '@/test/harness/i18n';
import { useCallStore } from '../../model/callStore';
import { CallHistoryItem } from './CallHistoryItem';

describe('CallHistoryItem', () => {
  const baseItem: ICallHistoryItemDto = {
    id: 'call-1',
    roomId: 'room-1',
    chatId: 'chat-42',
    peerId: 'user-2',
    peerName: 'Анна Смирнова',
    peerAvatar: 'https://example.com/avatar.jpg',
    direction: 'incoming',
    kind: 'audio',
    status: 'answered',
    startedAt: '2026-04-10T14:30:00Z',
    endedAt: '2026-04-10T14:32:05Z',
    durationSeconds: 125,
  };

  beforeEach(() => {
    useCallStore.setState(useCallStore.getInitialState(), true);
  });

  const renderItem = (
    item: ICallHistoryItemDto = baseItem,
    onOpenChat = vi.fn(),
    onOpenProfile = vi.fn()
  ) =>
    render(
      <I18nextProvider i18n={testI18n}>
        <CallHistoryItem item={item} onOpenChat={onOpenChat} onOpenProfile={onOpenProfile} />
      </I18nextProvider>
    );

  it('рендерит имя собеседника, входящий статус и длительность', () => {
    renderItem();

    expect(screen.getByText('Анна Смирнова')).toBeInTheDocument();
    expect(screen.getByText('Входящий')).toBeInTheDocument();
    expect(screen.getByText('2:05')).toBeInTheDocument();
  });

  it('рендерит длительность менее минуты в формате «28 сек»', () => {
    const shortCall: ICallHistoryItemDto = {
      ...baseItem,
      durationSeconds: 28,
    };
    renderItem(shortCall);
    expect(screen.getByText('28 сек')).toBeInTheDocument();
  });

  it('рендерит пропущенный вызов с соответствующим статусом', () => {
    const missedItem: ICallHistoryItemDto = {
      ...baseItem,
      status: 'missed',
      durationSeconds: 0,
    };

    renderItem(missedItem);

    expect(screen.getByText('Пропущенный')).toBeInTheDocument();
    expect(screen.queryByText('00:00')).not.toBeInTheDocument();
  });

  it('рендерит отменённый и отклонённый вызовы', () => {
    const cancelledItem: ICallHistoryItemDto = {
      ...baseItem,
      direction: 'outgoing',
      status: 'cancelled',
      durationSeconds: 0,
    };
    const { unmount } = renderItem(cancelledItem);
    expect(screen.getByText('Отменённый')).toBeInTheDocument();
    unmount();

    const rejectedItem: ICallHistoryItemDto = {
      ...baseItem,
      status: 'rejected',
      durationSeconds: 0,
    };
    renderItem(rejectedItem);
    expect(screen.getByText('Отклонённый')).toBeInTheDocument();
  });

  it('отображает видеозвонок с правильной иконкой и лейблом', () => {
    const videoItem: ICallHistoryItemDto = {
      ...baseItem,
      kind: 'video',
    };

    renderItem(videoItem);

    expect(screen.getByRole('button', { name: 'Видеозвонок' })).toBeInTheDocument();
  });

  it('клик по строке вызывает переход в чат', () => {
    const onOpenChat = vi.fn();
    renderItem(baseItem, onOpenChat);

    fireEvent.click(screen.getByRole('button', { name: /^Анна Смирнова/ }));
    expect(onOpenChat).toHaveBeenCalledWith('chat-42');
  });

  it('дизаблит действия при отсутствии chatId', () => {
    const onOpenChat = vi.fn();
    const itemWithoutChat: ICallHistoryItemDto = {
      ...baseItem,
      chatId: undefined,
    };
    renderItem(itemWithoutChat, onOpenChat);

    const rowButton = screen.getByRole('button', { name: /^Анна Смирнова/ });
    expect(rowButton).toBeDisabled();
    fireEvent.click(rowButton);
    expect(onOpenChat).not.toHaveBeenCalled();

    const callButton = screen.getByRole('button', { name: 'Аудиозвонок' });
    expect(callButton).toBeDisabled();
  });

  it('клик по кнопке повторного звонка инициирует вызов и не переходит в чат', () => {
    const initiateCallSpy = vi.fn();
    useCallStore.setState({ initiateCall: initiateCallSpy });
    const onOpenChat = vi.fn();
    renderItem(baseItem, onOpenChat);

    const callButton = screen.getByRole('button', { name: 'Аудиозвонок' });
    fireEvent.click(callButton);

    expect(initiateCallSpy).toHaveBeenCalledWith(
      'chat-42',
      'private',
      'Анна Смирнова',
      'audio',
      'user-2',
      'https://example.com/avatar.jpg',
      'Анна Смирнова'
    );
    expect(onOpenChat).not.toHaveBeenCalled();
  });

  it('дизаблит кнопку звонка, если уже есть активный вызов', () => {
    useCallStore.setState({
      activeCall: {
        roomId: 'active-1',
        type: 'direct',
        kind: 'audio',
        peerId: 'user-3',
      },
    });

    renderItem();

    const callButton = screen.getByRole('button', { name: 'Аудиозвонок' });
    expect(callButton).toBeDisabled();
  });

  // Профиль собеседника из строки истории (#1074).
  it('аватар открывает профиль, а не чат', () => {
    const onOpenChat = vi.fn();
    const onOpenProfile = vi.fn();
    renderItem(baseItem, onOpenChat, onOpenProfile);

    fireEvent.click(screen.getByRole('button', { name: 'Профиль: Анна Смирнова' }));

    expect(onOpenProfile).toHaveBeenCalledWith('chat-42', baseItem.peerId);
    expect(onOpenChat).not.toHaveBeenCalled();
  });

  it('строка по-прежнему открывает чат, а не профиль', () => {
    const onOpenChat = vi.fn();
    const onOpenProfile = vi.fn();
    renderItem(baseItem, onOpenChat, onOpenProfile);

    fireEvent.click(screen.getByRole('button', { name: /^Анна Смирнова/ }));

    expect(onOpenChat).toHaveBeenCalledWith('chat-42');
    expect(onOpenProfile).not.toHaveBeenCalled();
  });

  it('без чата профиль недоступен', () => {
    renderItem({ ...baseItem, chatId: undefined });

    expect(screen.getByRole('button', { name: 'Профиль: Анна Смирнова' })).toBeDisabled();
  });

  it('у прошлого звонка видны и дата, и время', () => {
    renderItem({ ...baseItem, startedAt: '2025-04-10T14:30:00Z' });

    expect(screen.getByText(/, \d\d:\d\d$/, { selector: 'time' })).toBeInTheDocument();
  });
});
