import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  Banner,
  ConfirmDialog,
  ListGroup,
  ListIntro,
  ListNavItem,
  ListStaticItem,
} from '@/shared/ui';
import { sessionsQuery } from '@/entities/user';
import { services } from '@/services/serviceContainer';
import { disconnectRealtimeSocket } from '@/shared/api';
import type { components } from '@/types/api.generated';

type AuthSession = components['schemas']['AuthSession'];

export function SessionsManager() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sessions = useQuery(sessionsQuery());

  const [asked, setAsked] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [logoutError, setLogoutError] = useState(false);

  async function handleLogoutAll() {
    setLeaving(true);
    setLogoutError(false);
    try {
      await services.authService.logoutAll();

      // Завершение всех сеансов стирает и ключи шифрования: это тот самый
      // случай, ради которого кнопку нажимают — чужой или потерянный
      // компьютер. История не пропадает: она в резервной копии (#739).
      await services.cryptoService.wipeDevice().catch(() => {});

      disconnectRealtimeSocket();

      /* Запрет из docs/frontend-data-architecture.md: без этого после
         входа другим пользователем в той же вкладке в памяти остаются
         чужие сообщения — расшифрованные. */
      queryClient.clear();

      navigate('/login');
    } catch {
      // Do not wipe this device or claim success when the server did not revoke
      // the other tokens (for example while a safe rollout gate is disabled).
      setLogoutError(true);
    } finally {
      setLeaving(false);
      setAsked(false);
    }
  }

  const sessionList = sessions.data ?? [];

  const current = sessionList.find((session) => session.isCurrent);
  const others = sessionList.filter((session) => !session.isCurrent);
  /* Тип с сервера — слово-код (desktop, mobile, tablet): показывать его
     как есть значило бы писать по-английски и в русском интерфейсе. */
  const deviceTypeLabel = (type: string | undefined) => {
    if (type === 'desktop') return t('settings.sessions.type.desktop', 'компьютер');
    if (type === 'mobile') return t('settings.sessions.type.mobile', 'телефон');
    if (type === 'tablet') return t('settings.sessions.type.tablet', 'планшет');
    return type || t('settings.sessions.type.unknown', 'неизвестно');
  };
  const formatDate = (value: string | number | undefined) =>
    value
      ? new Date(value).toLocaleString(i18n.language)
      : t('settings.sessions.noData', 'нет данных');

  const sessionItem = (session: AuthSession) => (
    <ListStaticItem
      hint={`${deviceTypeLabel(session.deviceType)} · ${formatDate(session.lastActive)}`}
      icon={session.deviceType === 'mobile' ? 'smartphone' : 'laptop'}
      key={session.id}
      label={session.deviceName || t('settings.sessions.device', 'Устройство')}
    />
  );

  /* Заголовок и «назад» — в шапке раздела настроек (#828). */
  return (
    <>
      <ListIntro>
        {t('settings.sessions.description', 'Устройства, на которых выполнен вход в аккаунт.')}
      </ListIntro>

      {sessions.isError && (
        <Banner tone="danger">
          {t(
            'settings.sessions.loadFailed',
            'Не удалось получить список устройств. Это не значит, что их нет, — попробуйте обновить страницу.'
          )}
        </Banner>
      )}

      {logoutError && (
        <Banner tone="danger">
          {t(
            'settings.sessions.terminateFailed',
            'Не удалось завершить сеансы. Другие устройства всё ещё могут иметь доступ к аккаунту; повторите попытку позже.'
          )}
        </Banner>
      )}

      {!sessions.isPending && !sessions.isError && sessionList.length === 0 && (
        <Banner icon="shield" tone="warn">
          {t(
            'settings.sessions.noneFound',
            'Активные сеансы не найдены. Это возможно для входа, выполненного до обновления учёта устройств; при необходимости завершите все сеансы кнопкой ниже.'
          )}
        </Banner>
      )}

      {!sessions.isPending && !sessions.isError && sessionList.length > 0 && !current && (
        <Banner icon="shield" tone="warn">
          {t(
            'settings.sessions.currentMissing',
            'Текущее устройство было авторизовано до обновления учёта сеансов и пока не отображается в списке.'
          )}
        </Banner>
      )}

      {sessions.isPending ? (
        <ListGroup>
          <ListStaticItem label={t('loading', 'Загрузка...')} />
        </ListGroup>
      ) : (
        sessionList.length > 0 && (
          <>
            {current && (
              <ListGroup title={t('settings.sessions.current', 'Это устройство')}>
                {sessionItem(current)}
              </ListGroup>
            )}
            {others.length > 0 && (
              <ListGroup title={t('settings.sessions.others', 'Другие сеансы')}>
                {others.map(sessionItem)}
              </ListGroup>
            )}
          </>
        )
      )}

      <ListGroup
        note={t(
          'settings.sessions.terminateNote',
          'Выход произойдёт на всех устройствах, включая это.'
        )}
      >
        <ListNavItem
          icon="logOut"
          label={t('settings.sessions.terminate', 'Завершить все сеансы')}
          onClick={() => setAsked(true)}
          tone="danger"
        />
      </ListGroup>

      <ConfirmDialog
        confirmLabel={t('settings.sessions.terminateConfirm', 'Завершить сеансы')}
        confirming={leaving}
        danger
        onCancel={() => setAsked(false)}
        onConfirm={handleLogoutAll}
        open={asked}
        title={t('settings.sessions.terminateTitle', 'Завершить все сеансы?')}
      >
        {t(
          'settings.sessions.terminateText',
          'Выход произойдёт на всех устройствах, а ключи шифрования с этого будут удалены. Переписка сохранена в резервной копии: после входа откройте её облачным паролем.'
        )}
      </ConfirmDialog>
    </>
  );
}
