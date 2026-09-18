import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Banner, Button, ConfirmDialog, Icon } from '@/shared/ui';
import { sessionsQuery } from '@/entities/user';
import { services } from '@/services/serviceContainer';
import { disconnectRealtimeSocket } from '@/hooks/useRealtimeSocket';
import type { ISessionDto } from '@/types';

interface Props {
  onBack: () => void;
}

export function SessionsManager({ onBack }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sessions = useQuery(sessionsQuery());

  const [asked, setAsked] = useState(false);
  const [leaving, setLeaving] = useState(false);

  async function handleLogoutAll() {
    setLeaving(true);
    try {
      await services.authService.logoutAll().catch(() => {});

      // Завершение всех сеансов стирает и ключи шифрования: это тот самый
      // случай, ради которого кнопку нажимают — чужой или потерянный
      // компьютер.
      await services.cryptoService.wipeDevice().catch(() => {});

      disconnectRealtimeSocket();

      /* Запрет из docs/frontend-data-architecture.md: без этого после
         входа другим пользователем в той же вкладке в памяти остаются
         чужие сообщения — расшифрованные. */
      queryClient.clear();

      navigate('/login');
    } finally {
      setLeaving(false);
      setAsked(false);
    }
  }

  const sessionList = (sessions.data ?? []) as ISessionDto[];

  return (
    <section>
      <button
        className="text-caption -ml-2 mb-3 flex items-center gap-1 rounded-control px-2 py-1 text-ink-2 transition-colors duration-fast hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
        onClick={onBack}
        type="button"
      >
        <Icon className="rotate-180" name="chevronRight" size="sm" />
        {t('back', 'Назад')}
      </button>

      <header className="mb-4">
        <h1 className="mb-1 text-[21px] leading-tight font-semibold text-ink">
          {t('settings.account.sessions', 'Активные сеансы')}
        </h1>
        <p className="text-caption text-ink-2">
          {t('settings.sessions.description', 'Устройства, на которых выполнен вход в аккаунт.')}
        </p>
      </header>

      {sessions.isError && (
        <Banner tone="danger">
          Не удалось получить список устройств. Это не значит, что их нет, — попробуйте обновить
          страницу.
        </Banner>
      )}

      {!sessions.isPending && !sessions.isError && sessionList.length === 0 && (
        <Banner icon="shield" tone="warn">
          Учёт устройств на сервере пока не ведётся, поэтому список всегда пуст. Это не значит, что
          входов с других устройств не было. Завершить все сеансы кнопкой ниже при этом можно — она
          отзывает выданные ранее ключи входа.
        </Banner>
      )}

      <div className="mt-4 divide-y divide-divider overflow-hidden rounded-bubble border border-line bg-sheet">
        {sessions.isPending ? (
          <div className="text-body p-5 text-center text-ink-2">Загрузка…</div>
        ) : sessionList.length > 0 ? (
          sessionList.map((session, index) => (
            <div className="flex items-center gap-3 p-4" key={session.id}>
              <Icon
                className="shrink-0 text-ink-3"
                name={session.deviceType === 'mobile' ? 'phone' : 'monitor'}
                size="md"
              />
              <div className="min-w-0">
                <strong className="text-body block truncate text-ink">
                  {session.deviceName || 'Устройство'}
                </strong>
                <span className="text-caption text-ink-2">
                  {session.deviceType || 'неизвестно'} · {formatDate(session.lastActive)}
                </span>
              </div>
              {index === 0 && (
                <b className="text-caption ml-auto shrink-0 font-medium text-ok">Текущий</b>
              )}
            </div>
          ))
        ) : (
          <div className="text-body p-5 text-center text-ink-2">
            {sessions.isError ? 'Список недоступен' : 'Список пуст'}
          </div>
        )}
      </div>

      <Button className="mt-4" onClick={() => setAsked(true)} variant="danger">
        {t('settings.sessions.terminate', 'Завершить все сеансы')}
      </Button>

      <ConfirmDialog
        confirmLabel="Завершить сеансы"
        confirming={leaving}
        danger
        onCancel={() => setAsked(false)}
        onConfirm={handleLogoutAll}
        open={asked}
        title="Завершить все сеансы?"
      >
        Выход произойдёт на всех устройствах, а ключи шифрования с этого будут удалены. Прошлая
        переписка здесь больше не откроется — восстановить её нечем.
      </ConfirmDialog>
    </section>
  );
}

function formatDate(value: string | number | undefined) {
  if (!value) return 'нет данных';
  return new Date(value).toLocaleString();
}
