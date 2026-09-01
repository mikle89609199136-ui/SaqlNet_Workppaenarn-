import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar, Banner, Button, ConfirmDialog, Input, Textarea } from '@/components/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  passwordFormSchema,
  profileFormSchema,
  twoFAFormSchema,
  type TPasswordForm,
  type TProfileForm,
  type TTwoFAForm,
} from '../accountSchemas';
import { ROUTES, isAccountSubsection, type TAccountSubsection } from '@/consts/routes';
import { disconnectRealtimeSocket } from '@/hooks/useRealtimeSocket';
import { useToasts } from '@/hooks/useToasts';
import { userKeys } from '@/queries/keys';
import { meQuery } from '@/queries/users/meQuery';
import { sessionsQuery, twoFAStatusQuery } from '@/queries/users/securityQueries';
import { services } from '@/services/serviceContainer';
import { useProfileStore } from '@/store';

/**
 * Раздел «Аккаунт»: обзор и подстраницы.
 *
 * Подстраница выбирается адресом (/settings/account/password), а не
 * состоянием — поэтому здесь только разбор параметра и переходы.
 *
 * Разметка и формы перенесены из прежней общей страницы без изменений:
 * их переписывание — отдельная работа (#473), и смешивать её с переездом
 * значило бы получить диff, в котором не видно ни того, ни другого.
 */
export function AccountSection() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToasts();
  const params = useParams<{ subsection: string }>();
  const { data: user = {}, isPending } = useQuery(meQuery());

  const view = isAccountSubsection(params.subsection) ? params.subsection : 'overview';

  /* Статус второй ступени и список устройств спрашиваются у сервера.
     Прежде они брались из useState — «отключена» и «сеансов нет»
     независимо от действительности (#478). */
  const twoFA = useQuery(twoFAStatusQuery());
  const sessions = useQuery(sessionsQuery());
  /* Какое действие ждёт подтверждения. Оба уводят из аккаунта, но одно из
     них вдобавок стирает ключи, поэтому спрашиваются они по-разному. */
  const [asked, setAsked] = useState<'logout' | 'logoutAll' | null>(null);
  const [leaving, setLeaving] = useState(false);

  const openView = (next: TAccountSubsection | 'overview') =>
    navigate(
      next === 'overview'
        ? ROUTES.SETTINGS_SECTION('account')
        : ROUTES.SETTINGS_SUBSECTION('account', next)
    );

  /**
   * Профиль изменил сам пользователь — обновляем оба его представления.
   *
   * Профиль задублирован кешем и стором, и стор читают 65 мест: расселение
   * этой пары — отдельная работа (#241), а не попутная правка.
   */
  function handleUserChange(next: any) {
    queryClient.setQueryData(userKeys.me(), next);
    useProfileStore.getState().setUser(next);
  }

  async function logout(all = false) {
    setLeaving(true);
    try {
      if (all) await services.authService.logoutAll().catch(() => {});
      else await services.authService.logout().catch(() => {});

      // Завершение всех сеансов стирает и ключи шифрования: это тот самый
      // случай, ради которого кнопку нажимают — чужой или потерянный
      // компьютер. Обычный выход ключи оставляет.
      if (all) await services.cryptoService.wipeDevice().catch(() => {});

      disconnectRealtimeSocket();

      /* Запрет из docs/frontend-data-architecture.md: без этого после
         входа другим пользователем в той же вкладке в памяти остаются
         чужие сообщения — расшифрованные. */
      queryClient.clear();

      navigate('/login');
    } finally {
      setLeaving(false);
      setAsked(null);
    }
  }

  if (isPending) return <div className="settings-detail-state">Загрузка…</div>;

  /* Подстраница выбирается функцией, а не ранними возвратами из раздела:
     окно подтверждения общее, и при выходе по return его бы просто не
     оказалось в разметке. */
  function renderView() {
    if (view === 'profile') {
      return (
        <ProfileSettings
          onBack={() => openView('overview')}
          onUserChange={handleUserChange}
          showToast={showToast}
          user={user}
        />
      );
    }

    if (view === 'password') {
      return <PasswordSettings onBack={() => openView('overview')} showToast={showToast} />;
    }

    if (view === 'email') {
      return <EmailSettings onBack={() => openView('overview')} user={user} />;
    }

    if (view === 'twoFA') {
      return (
        <TwoFASettings
          enabled={twoFA.data}
          loading={twoFA.isPending}
          onBack={() => openView('overview')}
          onEnabledChange={() => void twoFA.refetch()}
          showToast={showToast}
        />
      );
    }

    if (view === 'sessions') {
      return (
        <SessionsSettings
          error={sessions.isError}
          loading={sessions.isPending}
          onBack={() => openView('overview')}
          onLogoutAll={() => setAsked('logoutAll')}
          sessions={sessions.data ?? []}
        />
      );
    }

    return (
      <AccountSettings
        onEditProfile={() => openView('profile')}
        onLogout={() => setAsked('logout')}
        onOpenEmail={() => openView('email')}
        onOpenPassword={() => openView('password')}
        onOpenSessions={() => openView('sessions')}
        onOpenTwoFA={() => openView('twoFA')}
        sessionsCount={sessions.data?.length}
        twoFAEnabled={twoFA.data}
        user={user}
      />
    );
  }

  const confirmations = {
    logout: {
      title: 'Выйти из аккаунта?',
      confirmLabel: 'Выйти',
      danger: false,
      text: 'Переписка останется на этом устройстве и откроется после следующего входа.',
    },
    logoutAll: {
      title: 'Завершить все сеансы?',
      confirmLabel: 'Завершить сеансы',
      danger: true,
      text: 'Выход произойдёт на всех устройствах, а ключи шифрования с этого будут удалены. Прошлая переписка здесь больше не откроется — восстановить её нечем.',
    },
  } as const;

  const confirmation = asked ? confirmations[asked] : null;

  return (
    <>
      {renderView()}

      {confirmation && (
        <ConfirmDialog
          confirmLabel={confirmation.confirmLabel}
          confirming={leaving}
          danger={confirmation.danger}
          onCancel={() => setAsked(null)}
          onConfirm={() => void logout(asked === 'logoutAll')}
          open
          title={confirmation.title}
        >
          {confirmation.text}
        </ConfirmDialog>
      )}
    </>
  );
}

function AccountSettings({
  user,
  sessionsCount,
  twoFAEnabled,
  onLogout,
  onEditProfile,
  onOpenEmail,
  onOpenPassword,
  onOpenTwoFA,
  onOpenSessions,
}) {
  return (
    <>
      <section className="settings-account-overview">
        <h1>Аккаунт</h1>
        <div className="settings-account-summary settings-overview-profile">
          <Avatar
            id={user.id}
            name={user.firstName || user.username}
            size="xl"
            src={user.avatarUrl}
          />
          <div className="settings-account-identity">
            <strong>
              {[user.firstName, user.lastName].filter(Boolean).join(' ') ||
                user.username ||
                'Пользователь'}
            </strong>
            <span>{user.online ? 'в сети' : `@${user.username || 'user'}`}</span>
          </div>
          <button type="button" className="settings-edit-profile" onClick={onEditProfile}>
            Изменить профиль
          </button>
        </div>
        <h2>Настройки аккаунта</h2>
        <div className="settings-overview-group">
          <button type="button" onClick={onOpenEmail}>
            <span>Электронная почта</span>
            <span>
              {user.email || 'не привязана'}
              <b>›</b>
            </span>
          </button>
          <button type="button" onClick={onOpenPassword}>
            <span>Пароль</span>
            <span>
              •••••••••• <b>›</b>
            </span>
          </button>
          <button type="button" onClick={onOpenTwoFA}>
            <span>Двухфакторная аутентификация</span>
            {/* Пока ответ не пришёл — прочерк, а не «отключена»: в разделе
                безопасности выдуманное значение хуже отсутствия ответа. */}
            <span>
              {twoFAEnabled === undefined ? '—' : twoFAEnabled ? 'включена' : 'отключена'}
              <b>›</b>
            </span>
          </button>
        </div>
        <h2>Действия</h2>
        <div className="settings-overview-group">
          <button type="button" onClick={onOpenSessions}>
            <span>Активные сеансы</span>
            <span>
              {sessionsCount ?? '—'}
              <b>›</b>
            </span>
          </button>
          <button type="button" onClick={() => onLogout(false)}>
            <span>Выйти из аккаунта</span>
            <span className="settings-overview-danger">Выйти</span>
          </button>
        </div>
      </section>
    </>
  );
}

function EmailSettings({ user, onBack }) {
  return (
    <AccountSubpage
      description="Адрес для уведомлений и восстановления доступа."
      onBack={onBack}
      title="Электронная почта"
    >
      {/* Форма здесь была, но сервер почту не принимает: PUT /users/me
          знает только firstName, lastName, bio и avatarUrl. Поле с кнопкой
          «Сохранить» обещало то, чего не происходит, — теперь сказано
          прямо. */}
      <Banner icon="info" tone="info">
        Привязка почты пока не работает: сервер её не сохраняет. Восстановить доступ по адресу
        нельзя — пароль держите под рукой.
      </Banner>

      <p className="text-body mt-4 text-ink-2">
        Текущий адрес: <span className="text-ink">{user.email || 'не привязан'}</span>
      </p>
    </AccountSubpage>
  );
}

function PasswordSettings({ onBack, showToast }) {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<TPasswordForm>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmation: '' },
    // Ругаться на человека, пока он печатает, незачем: правила проверяются,
    // когда поле покинули, и дальше — на каждый ввод, чтобы исправленная
    // ошибка сразу исчезала.
    mode: 'onTouched',
  });

  async function submit(values: TPasswordForm) {
    try {
      await services.authService.changePassword(values.currentPassword, values.newPassword);
      showToast('success', 'Пароль изменён');
      onBack();
    } catch (error) {
      /* Неверный текущий пароль — ошибка поля, а не всей формы: тост
         исчезнет, а подпись под полем останется и скажет, что править. */
      if ((error as { data?: { code?: string } })?.data?.code === 'wrong_password') {
        setError('currentPassword', { message: 'Неверный текущий пароль' }, { shouldFocus: true });
        return;
      }
      showToast('error', 'Не удалось изменить пароль');
    }
  }

  return (
    <AccountSubpage
      title="Изменить пароль"
      description="Используйте не менее 10 символов."
      onBack={onBack}
    >
      <form className="grid gap-4" onSubmit={handleSubmit(submit)}>
        <Input
          autoComplete="current-password"
          error={errors.currentPassword?.message}
          label="Текущий пароль"
          type="password"
          {...register('currentPassword')}
        />
        <Input
          autoComplete="new-password"
          error={errors.newPassword?.message}
          label="Новый пароль"
          type="password"
          {...register('newPassword')}
        />
        <Input
          autoComplete="new-password"
          error={errors.confirmation?.message}
          label="Повторите новый пароль"
          type="password"
          {...register('confirmation')}
        />

        <div className="mt-2 flex justify-end gap-2">
          <Button onClick={onBack} type="button" variant="ghost">
            Отмена
          </Button>
          <Button loading={isSubmitting} type="submit">
            Изменить пароль
          </Button>
        </div>
      </form>
    </AccountSubpage>
  );
}

function TwoFASettings({ enabled, loading, onBack, onEnabledChange, showToast }) {
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TTwoFAForm>({
    resolver: zodResolver(twoFAFormSchema),
    defaultValues: { password: '' },
    mode: 'onTouched',
  });

  async function submit(values: TTwoFAForm) {
    try {
      await services.authService.setTwoFA(!enabled, values.password);
      onEnabledChange();
      showToast('success', enabled ? 'Вторая ступень отключена' : 'Вторая ступень включена');
      onBack();
    } catch (error) {
      const code = (error as { data?: { code?: string } })?.data?.code;
      /* Отключение проверяет пароль на сервере — и неверный это ошибка
         поля, а не всей формы. */
      if (code === 'wrong_password' || code === 'invalid_2fa') {
        setError('password', { message: 'Неверный пароль' }, { shouldFocus: true });
        return;
      }
      reset();
      showToast('error', 'Не удалось изменить настройки');
    }
  }

  return (
    <AccountSubpage
      description="Дополнительный пароль, который спрашивают при входе."
      onBack={onBack}
      title="Двухфакторная аутентификация"
    >
      {/* Пока ответ не пришёл, состояние неизвестно — и говорится именно
          это. Написать «отключена» значило бы успокоить человека, который
          пришёл проверить, защищён ли его аккаунт. */}
      <Banner icon="shield" tone={enabled ? 'success' : 'info'}>
        {loading
          ? 'Проверяем состояние защиты…'
          : enabled === undefined
            ? 'Состояние защиты неизвестно: сервер не ответил.'
            : enabled
              ? 'Защита включена: при входе спросят второй пароль.'
              : 'Защита отключена: для входа достаточно основного пароля.'}
      </Banner>

      <form className="mt-4 grid gap-4" onSubmit={handleSubmit(submit)}>
        <Input
          autoComplete="off"
          error={errors.password?.message}
          hint={enabled ? 'Введите второй пароль, чтобы отключить защиту' : undefined}
          label="Второй пароль"
          type="password"
          {...register('password')}
        />

        <div className="mt-2 flex justify-end gap-2">
          <Button onClick={onBack} type="button" variant="ghost">
            Отмена
          </Button>
          <Button
            disabled={enabled === undefined}
            loading={isSubmitting}
            type="submit"
            variant={enabled ? 'danger' : 'primary'}
          >
            {enabled ? 'Отключить' : 'Включить'}
          </Button>
        </div>
      </form>
    </AccountSubpage>
  );
}

function SessionsSettings({ sessions, loading, error, onLogoutAll, onBack }) {
  return (
    <AccountSubpage
      title="Активные сеансы"
      description="Устройства, на которых выполнен вход в аккаунт."
      onBack={onBack}
    >
      {/* Ошибку видно как ошибку: «сеансов нет» здесь читается как «никто
          чужой не входил», и подменять этим неполученный ответ нельзя. */}
      {error && (
        <Banner tone="danger">
          Не удалось получить список устройств. Это не значит, что их нет, — попробуйте обновить
          страницу.
        </Banner>
      )}

      {/* Список пуст не потому, что входов не было: сервер сеансы не
          записывает вовсе — в auth.sessions нет ни одной вставки, только
          чтение и отзыв. Пока это так, «активных сеансов нет» читалось бы
          как «никто чужой не входил», а это не проверено ничем. */}
      {!loading && !error && sessions.length === 0 && (
        <Banner icon="shield" tone="warn">
          Учёт устройств на сервере пока не ведётся, поэтому список всегда пуст. Это не значит, что
          входов с других устройств не было. Завершить все сеансы кнопкой ниже при этом можно — она
          отзывает выданные ранее ключи входа.
        </Banner>
      )}

      <div className="settings-sessions-card">
        {loading ? (
          <div className="settings-sessions-empty">Загрузка…</div>
        ) : sessions.length > 0 ? (
          sessions.map((session, index) => (
            <div className="settings-session-row" key={session.id}>
              <span className="settings-session-device">
                {session.deviceType === 'mobile' ? '▯' : '▱'}
              </span>
              <div>
                <strong>{session.deviceName || 'Устройство'}</strong>
                <span>
                  {session.deviceType || 'unknown'} · {formatDate(session.lastActive)}
                </span>
              </div>
              {index === 0 && <b>Текущий</b>}
            </div>
          ))
        ) : (
          <div className="settings-sessions-empty">
            {error ? 'Список недоступен' : 'Список пуст'}
          </div>
        )}
      </div>
      <button type="button" className="settings-terminate-sessions" onClick={onLogoutAll}>
        Завершить все сеансы
      </button>
    </AccountSubpage>
  );
}

function AccountSubpage({ title, description, onBack, children }) {
  return (
    <section className="settings-profile-editor settings-account-subpage">
      <button type="button" className="settings-detail-back" onClick={onBack}>
        ‹ <span>Назад</span>
      </button>
      <header className="settings-profile-editor-header">
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      {children}
    </section>
  );
}

function ProfileSettings({ user, onUserChange, onBack, showToast }) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<TProfileForm>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      bio: user.bio || '',
    },
    mode: 'onTouched',
  });

  const bio = watch('bio') ?? '';

  async function submit(values: TProfileForm) {
    try {
      const updated = await services.userService.updateMe(values);
      onUserChange(updated);
      showToast('success', 'Профиль обновлён');
      onBack();
    } catch (_) {
      showToast('error', 'Не удалось обновить профиль');
    }
  }

  return (
    <AccountSubpage
      description="Обновите имя и информацию, которую видят другие пользователи."
      onBack={onBack}
      title="Изменить профиль"
    >
      <div className="mb-6 flex items-center gap-4 rounded-bubble border border-line bg-sheet p-4">
        <Avatar
          id={user.id}
          name={user.firstName || user.username}
          size="xl"
          src={user.avatarUrl}
        />
        <div className="min-w-0">
          <strong className="text-body block truncate text-ink">
            {[user.firstName, user.lastName].filter(Boolean).join(' ') ||
              user.username ||
              'Пользователь'}
          </strong>
          <span className="text-caption text-ink-2">@{user.username || 'user'}</span>
        </div>
        {/* Загрузка фото делается в #485: сервер принимает ссылку, а файл
            нужно сперва отправить в медиа-сервис. */}
        <Button
          className="ml-auto"
          disabled
          title="Загрузка фото пока недоступна"
          variant="secondary"
        >
          Изменить фото
        </Button>
      </div>

      <form className="grid gap-4" onSubmit={handleSubmit(submit)}>
        <Input error={errors.firstName?.message} label="Имя" {...register('firstName')} />
        <Input error={errors.lastName?.message} label="Фамилия" {...register('lastName')} />
        <Textarea
          error={errors.bio?.message}
          /* Счётчик стоит там же, где обычно подсказка: предел виден до
             того, как в него упрёшься. */
          hint={`${bio.length} / 160`}
          label="О себе"
          rows={3}
          {...register('bio')}
        />

        <div className="mt-2 flex justify-end gap-2">
          <Button onClick={onBack} type="button" variant="ghost">
            Отмена
          </Button>
          {/* Нечего сохранять — незачем и предлагать. */}
          <Button disabled={!isDirty} loading={isSubmitting} type="submit">
            Сохранить
          </Button>
        </div>
      </form>
    </AccountSubpage>
  );
}

function formatDate(value) {
  if (!value) return 'нет данных';
  return new Date(value).toLocaleString();
}
