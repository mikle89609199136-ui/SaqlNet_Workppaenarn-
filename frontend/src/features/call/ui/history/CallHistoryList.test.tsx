import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { services } from '@/services/serviceContainer';
import type { ICallHistoryItemDto } from '@/services/types/callApi.types';
import { testI18n } from '@/test/harness/i18n';
import { callKeys } from '../../model/callKeys';
import { CallHistoryList } from './CallHistoryList';

describe('CallHistoryList', () => {
  let queryClient: QueryClient;

  const sampleCall: ICallHistoryItemDto = {
    id: 'call-101',
    roomId: 'room-101',
    chatId: 'chat-101',
    peerId: 'user-101',
    peerName: 'Сергей Иванов',
    direction: 'incoming',
    kind: 'audio',
    status: 'answered',
    startedAt: '2026-04-10T12:00:00Z',
    durationSeconds: 60,
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 0,
        },
      },
    });
    vi.restoreAllMocks();
  });

  const renderComponent = (onOpenChat = vi.fn(), onOpenProfile = vi.fn()) =>
    render(
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={testI18n}>
          <CallHistoryList onOpenChat={onOpenChat} onOpenProfile={onOpenProfile} />
        </I18nextProvider>
      </QueryClientProvider>
    );

  it('рендерит скелетоны при загрузке данных', () => {
    // Бесконечный pending промис
    vi.spyOn(services.callService, 'getCallHistory').mockReturnValue(new Promise(() => {}));

    renderComponent();

    expect(screen.getAllByTestId('call-history-skeleton').length).toBeGreaterThan(0);
  });

  it('рендерит пустое состояние, если звонков нет', async () => {
    queryClient.setQueryData(callKeys.history(), {
      pages: [{ calls: [], nextCursor: null, hasMore: false }],
      pageParams: [undefined],
    });

    renderComponent();

    expect(await screen.findByText('Звонков пока нет')).toBeInTheDocument();
  });

  it('рендерит состояние ошибки с кнопкой повтора', async () => {
    vi.spyOn(services.callService, 'getCallHistory').mockRejectedValue(new Error('Сетевой сбой'));

    renderComponent();

    expect(await screen.findByText('Не удалось загрузить историю звонков')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });

  it('рендерит локализованную ошибку по коду ответа сервера', async () => {
    vi.spyOn(services.callService, 'getCallHistory').mockRejectedValue({ code: 'access_denied' });

    renderComponent();

    expect(await screen.findByText('Нет доступа')).toBeInTheDocument();
  });

  it('рендерит список звонков', async () => {
    queryClient.setQueryData(callKeys.history(), {
      pages: [{ calls: [sampleCall], nextCursor: null, hasMore: false }],
      pageParams: [undefined],
    });

    renderComponent();

    expect(await screen.findByText('Сергей Иванов')).toBeInTheDocument();
    expect(screen.getByTestId('call-history-item')).toBeInTheDocument();
  });

  it('профиль из строки доходит до того, кто собирает экран (#1074)', async () => {
    queryClient.setQueryData(callKeys.history(), {
      pages: [{ calls: [sampleCall], nextCursor: null, hasMore: false }],
      pageParams: [undefined],
    });
    const onOpenProfile = vi.fn();

    renderComponent(vi.fn(), onOpenProfile);
    fireEvent.click(await screen.findByRole('button', { name: 'Профиль: Сергей Иванов' }));

    expect(onOpenProfile).toHaveBeenCalledWith(sampleCall.chatId, sampleCall.peerId);
  });

  it('отображает кнопку дозагрузки при наличии следующей страницы', async () => {
    const fetchNextSpy = vi.spyOn(services.callService, 'getCallHistory').mockResolvedValue({
      calls: [{ ...sampleCall, id: 'call-102', peerName: 'Ольга Павлова' }],
      nextCursor: null,
      hasMore: false,
    });

    queryClient.setQueryData(callKeys.history(), {
      pages: [{ calls: [sampleCall], nextCursor: 'cursor-2', hasMore: true }],
      pageParams: [undefined],
    });

    renderComponent();

    const loadMoreBtn = await screen.findByRole('button', { name: 'Загрузить ещё' });
    expect(loadMoreBtn).toBeInTheDocument();

    fireEvent.click(loadMoreBtn);
    expect(fetchNextSpy).toHaveBeenCalledWith({ cursor: 'cursor-2' });
  });
});
