import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Avatar,
  Banner,
  Button,
  ConfirmDialog,
  Icon,
  Input,
  Textarea,
  showToast,
} from '@/shared/ui';
import { PasswordRequirements } from '@/components/features';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  passwordFormSchema,
  profileFormSchema,
  type TPasswordForm,
  type TProfileForm,
} from '../accountSchemas';
import { ROUTES, isAccountSubsection, type TAccountSubsection } from '@/shared/config/routes';
import { disconnectRealtimeSocket } from '@/hooks/useRealtimeSocket';
import { userKeys } from '@/queries/keys';
import { meQuery } from '@/queries/users/meQuery';
import { sessionsQuery } from '@/queries/users/securityQueries';
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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ subsection: string }>();
  const { data: user = {}, isPending } = useQuery(meQuery());

  const view = isAccountSubsection(params.subsection) ? params.subsection : 'overview';

  /* Список устройств спрашивается у сервера. Прежде он брался из
     useState — «сеансов нет» независимо от действительности (#478). */
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

  if (isPending) return <div className="text-body py-16 text-center text-ink-2">Загрузка…</div>;

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
        t={t}
        onEditProfile={() => openView('profile')}
        onLogout={() => setAsked('logout')}
        onOpenEmail={() => openView('email')}
        onOpenPassword={() => openView('password')}
        onOpenSessions={() => openView('sessions')}
        sessionsCount={sessions.data?.length}
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

/**
 * Строка обзора: подпись слева, текущее значение и стрелка справа.
 *
 * Выделена, потому что таких строк шесть и все ведут на подстраницу.
 * Значение здесь — не украшение: по нему видно, привязана ли почта и
 * включена ли защита, не заходя внутрь.
 */
function OverviewRow({ label, value, onClick }: OverviewRowProps) {
  return (
    <button
      className="text-body flex min-h-[52px] w-full items-center justify-between gap-4 px-5 py-3 text-left text-ink transition-colors duration-fast hover:bg-sheet-2 focus-visible:outline focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand"
      onClick={onClick}
      type="button"
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className="flex shrink-0 items-center gap-2 text-ink-2">
        {value}
        <Icon className="text-ink-3" name="chevronRight" size="sm" />
      </span>
    </button>
  );
}

interface OverviewRowProps {
  label: string;
  value?: ReactNode;
  onClick: () => void;
}

function AccountSettings({
  t,
  user,
  sessionsCount,
  onLogout,
  onEditProfile,
  onOpenEmail,
  onOpenPassword,
  onOpenSessions,
}) {
  const name =
    [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'Пользователь';

  return (
    <section>
      <h1 className="mb-5 text-[27px] leading-tight font-semibold text-ink">
        {t('settings.account.title', 'Аккаунт')}
      </h1>

      <div className="mb-7 flex items-center gap-4 rounded-bubble border border-line bg-sheet p-4">
        <Avatar
          id={user.id}
          name={user.firstName || user.username}
          size="xl"
          src={user.avatarUrl}
        />
        <div className="min-w-0">
          <strong className="text-body block truncate text-ink">{name}</strong>
          <span className="text-caption text-ink-2">
            {user.online ? 'в сети' : `@${user.username || 'user'}`}
          </span>
        </div>
        <Button className="ml-auto" onClick={onEditProfile} variant="secondary">
          {t('settings.account.editProfile', 'Изменить профиль')}
        </Button>
      </div>

      <h2 className="text-caption mb-3 font-semibold text-ink-2">
        {t('settings.account.groupSettings', 'Настройки аккаунта')}
      </h2>
      {/* Строки разделены линией внутри блока — line-soft, а не line:
          она делит содержимое, а не очерчивает элемент управления (#374). */}
      <div className="mb-7 divide-y divide-divider overflow-hidden rounded-bubble border border-line bg-sheet">
        <OverviewRow
          label={t('settings.account.email', 'Электронная почта')}
          onClick={onOpenEmail}
          value={user.email || t('settings.account.emailEmpty', 'не привязана')}
        />
        <OverviewRow
          label={t('settings.account.password', 'Пароль')}
          onClick={onOpenPassword}
          value="••••••••••"
        />
      </div>

      <h2 className="text-caption mb-3 font-semibold text-ink-2">
        {t('settings.account.groupActions', 'Действия')}
      </h2>
      <div className="divide-y divide-divider overflow-hidden rounded-bubble border border-line bg-sheet">
        <OverviewRow
          label={t('settings.account.sessions', 'Активные сеансы')}
          onClick={onOpenSessions}
          value={sessionsCount ?? '—'}
        />
        <OverviewRow
          label={t('settings.account.logout', 'Выйти из аккаунта')}
          onClick={() => onLogout(false)}
          value={<span className="text-danger">{t('settings.account.logoutAction', 'Выйти')}</span>}
        />
      </div>
    </section>
  );
}

function EmailSettings({ user, onBack }) {
  const { t } = useTranslation();
  return (
    <AccountSubpage
      description={t(
        'settings.email.description',
        'Адрес для уведомлений и восстановления доступа.'
      )}
      onBack={onBack}
      title={t('settings.account.email', 'Электронная почта')}
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
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<TPasswordForm>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmation: '' },
    // Ругаться на человека, пока он печатает, незачем: правила проверяются,
    // когда поле покинули, и дальше — на каждый ввод, чтобы исправленная
    // ошибка сразу исчезала.
    mode: 'onTouched',
  });

  const newPassword = watch('newPassword');

  async function submit(values: TPasswordForm) {
    try {
      await services.authService.changePassword(values.currentPassword, values.newPassword);
      showToast('success', t('toast.passwordChanged', 'Пароль изменён'));
      onBack();
    } catch (error) {
      /* Неверный текущий пароль — ошибка поля, а не всей формы: тост
         исчезнет, а подпись под полем останется и скажет, что править. */
      const code = (error as { data?: { code?: string } })?.data?.code;

      if (code === 'wrong_password') {
        setError('currentPassword', { message: 'Неверный текущий пароль' }, { shouldFocus: true });
        return;
      }

      /* Сервер отверг пароль своей политикой. Наши правила её повторяют,
         но могли отстать — тогда причину показываем у поля, а не тостом. */
      if (code === 'weak_password') {
        setError(
          'newPassword',
          { message: t('settings.password.weak', 'Пароль не отвечает требованиям') },
          { shouldFocus: true }
        );
        return;
      }
      showToast('error', t('toast.passwordChangeFailed', 'Не удалось изменить пароль'));
    }
  }

  return (
    <AccountSubpage
      title={t('settings.password.title', 'Изменить пароль')}
      description={t('settings.password.description', 'Используйте не менее 10 символов.')}
      onBack={onBack}
    >
      <form className="grid gap-4" onSubmit={handleSubmit(submit)}>
        <Input
          autoComplete="current-password"
          error={errors.currentPassword?.message}
          label={t('settings.password.current', 'Текущий пароль')}
          type="password"
          {...register('currentPassword')}
        />
        <div>
          <Input
            autoComplete="new-password"
            error={errors.newPassword?.message}
            label={t('settings.password.new', 'Новый пароль')}
            type="password"
            {...register('newPassword')}
          />
          {/* Требования те же, что при регистрации, и показаны так же:
              иначе человек узнаёт о них по одному, из сообщений об ошибке. */}
          {newPassword.length > 0 && <PasswordRequirements value={newPassword} />}
        </div>
        <Input
          autoComplete="new-password"
          error={errors.confirmation?.message}
          label={t('settings.password.repeat', 'Повторите новый пароль')}
          type="password"
          {...register('confirmation')}
        />

        <div className="mt-2 flex justify-end gap-2">
          <Button onClick={onBack} type="button" variant="ghost">
            {t('cancel', 'Отмена')}
          </Button>
          <Button loading={isSubmitting} type="submit">
            {t('settings.password.action', 'Изменить пароль')}
          </Button>
        </div>
      </form>
    </AccountSubpage>
  );
}

function SessionsSettings({ sessions, loading, error, onLogoutAll, onBack }) {
  const { t } = useTranslation();
  return (
    <AccountSubpage
      title={t('settings.account.sessions', 'Активные сеансы')}
      description={t(
        'settings.sessions.description',
        'Устройства, на которых выполнен вход в аккаунт.'
      )}
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

      <div className="mt-4 divide-y divide-divider overflow-hidden rounded-bubble border border-line bg-sheet">
        {loading ? (
          <div className="text-body p-5 text-center text-ink-2">Загрузка…</div>
        ) : sessions.length > 0 ? (
          sessions.map((session, index) => (
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
            {error ? 'Список недоступен' : 'Список пуст'}
          </div>
        )}
      </div>
      <Button className="mt-4" onClick={onLogoutAll} variant="danger">
        {t('settings.sessions.terminate', 'Завершить все сеансы')}
      </Button>
    </AccountSubpage>
  );
}

function AccountSubpage({ title, description, onBack, children }) {
  const { t } = useTranslation();
  return (
    <section>
      <button
        className="text-caption -ml-2 mb-3 flex items-center gap-1 rounded-control px-2 py-1 text-ink-2 transition-colors duration-fast hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        onClick={onBack}
        type="button"
      >
        <Icon name="chevronRight" size="sm" className="rotate-180" />
        {t('back', 'Назад')}
      </button>

      <header className="mb-4">
        <h1 className="mb-1 text-[21px] leading-tight font-semibold text-ink">{title}</h1>
        {description && <p className="text-caption text-ink-2">{description}</p>}
      </header>

      {children}
    </section>
  );
}

function ProfileSettings({ user, onUserChange, onBack, showToast }) {
  const { t } = useTranslation();
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
      showToast('success', t('toast.profileUpdated', 'Профиль обновлён'));
      onBack();
    } catch (_) {
      showToast('error', t('profileSaveError', 'Не удалось сохранить профиль'));
    }
  }

  return (
    <AccountSubpage
      description={t(
        'settings.profile.description',
        'Обновите имя и информацию, которую видят другие пользователи.'
      )}
      onBack={onBack}
      title={t('settings.profile.title', 'Изменить профиль')}
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
          title={t('settings.profile.photoDisabled', 'Загрузка фото пока недоступна')}
          variant="secondary"
        >
          {t('settings.profile.changePhoto', 'Изменить фото')}
        </Button>
      </div>

      <form className="grid gap-4" onSubmit={handleSubmit(submit)}>
        <Input
          error={errors.firstName?.message}
          label={t('settings.profile.firstName', 'Имя')}
          {...register('firstName')}
        />
        <Input
          error={errors.lastName?.message}
          label={t('settings.profile.lastName', 'Фамилия')}
          {...register('lastName')}
        />
        <Textarea
          error={errors.bio?.message}
          /* Счётчик стоит там же, где обычно подсказка: предел виден до
             того, как в него упрёшься. */
          hint={`${bio.length} / 160`}
          label={t('settings.profile.bio', 'О себе')}
          rows={3}
          {...register('bio')}
        />

        <div className="mt-2 flex justify-end gap-2">
          <Button onClick={onBack} type="button" variant="ghost">
            {t('cancel', 'Отмена')}
          </Button>
          {/* Нечего сохранять — незачем и предлагать. */}
          <Button disabled={!isDirty} loading={isSubmitting} type="submit">
            {t('save', 'Сохранить')}
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
