import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { blockedUsersQuery } from '@/entities/user';
import { BlockedUsersManager } from '@/features/block-user';
import { ROUTES, isPrivacySubsection } from '@/shared/config/routes';
import { Icon, RadioGroup } from '@/shared/ui';
import type { TPrivacyVisibility } from '@/types';
import { SettingsSection } from '../SettingsControls';
import { useTranslation } from 'react-i18next';
import { useSettingsData } from './useSettingsData';

/* Варианты показаны сразу, а не спрятаны в список: выбор читается одним
   взглядом. «Контакты» убраны (#726): контактов в приложении нет, и сервер
   всё равно сохранял этот вариант как «Никто». */
const VISIBILITY_VALUES = ['all', 'nobody'] as const;

/* Сервер проверяет значение и ответит 400 на незнакомое (#783), но наверх
   и так уходит только то, что предложено человеку. */
function isVisibility(value: string): value is TPrivacyVisibility {
  return (VISIBILITY_VALUES as readonly string[]).includes(value);
}

/* Подпись группы приводится к виду подписи ряда, чтобы названия настроек
   на экране не выглядели по-разному. Компонент рисует legend как подпись
   поля, поэтому вид задаётся здесь, а не внутри него. */
const GROUP_LABEL = '[&>legend]:text-body [&>legend]:mb-2 [&>legend]:text-ink';

export function PrivacySection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ subsection: string }>();
  const { privacy, savePrivacy } = useSettingsData();
  const blocked = useQuery(blockedUsersQuery());

  if (isPrivacySubsection(params.subsection)) {
    return <BlockedUsersManager onBack={() => navigate(ROUTES.SETTINGS_SECTION('privacy'))} />;
  }

  const visibilityOptions = [
    { value: 'all', label: t('settings.privacy.lastSeenAll', 'Все') },
    { value: 'nobody', label: t('settings.privacy.lastSeenNobody', 'Никто') },
  ];

  return (
    <SettingsSection
      description={t('settings.privacy.description', 'Управляйте тем, кто видит ваши данные.')}
      title={t('settings.privacy.title', 'Конфиденциальность')}
    >
      {/* Подпись группы рисует она сама — это legend внутри fieldset.
          Подменять его подписью ряда значило бы разорвать связь для
          диктора, поэтому здесь группа стоит без обёртки. */}
      <RadioGroup
        className={GROUP_LABEL}
        /* Что будет при «Никто» (#791): другие видят промежуток вместо
           времени, и это взаимно — как в Telegram. */
        hint={t(
          'settings.privacy.lastSeenHint',
          'Если скрыть время, собеседники увидят только приблизительное: «недавно», «на этой неделе», «в этом месяце» или «давно». Но и вы не будете видеть точное время других.'
        )}
        label={t('settings.privacy.lastSeen', 'Последняя активность')}
        name="lastSeen"
        onChange={(value) => isVisibility(value) && savePrivacy({ lastSeen: value })}
        options={visibilityOptions}
        orientation="horizontal"
        value={privacy.lastSeen ?? 'all'}
      />

      {/* Как «Пересылка сообщений» в Telegram (#785): при «Никто» имя в
          пересланном сообщении не ведёт к профилю. Решение фиксируется при
          пересылке — уже пересланное настройка не меняет. */}
      <RadioGroup
        className={GROUP_LABEL}
        hint={t(
          'settings.privacy.forwardsHint',
          'При «Никто» в ваших сообщениях, которые перешлют другие, останется только ваше имя — без перехода в ваш профиль. Уже пересланные сообщения не изменятся.'
        )}
        label={t('settings.privacy.forwards', 'Пересылка сообщений')}
        name="forwards"
        onChange={(value) => isVisibility(value) && savePrivacy({ forwards: value })}
        options={visibilityOptions}
        orientation="horizontal"
        value={privacy.forwards ?? 'all'}
      />

      {/* «Сообщения от незнакомых» убраны (#465): сервер этот переключатель
          не применял, а без контактов незнакомого не определить. Вместо
          запрета — плашка «Заблокировать / Пожаловаться» в новом чате. */}

      {/* Чёрный список — отдельной подстраницей (#727): список людей не
          помещается рядом с переключателями. */}
      <button
        className="text-body -mx-1 flex min-h-11 w-[calc(100%+0.5rem)] items-center justify-between gap-4 rounded-control px-1 text-left text-ink transition-colors duration-fast hover:bg-sheet-2 focus-visible:outline-2 focus-visible:outline-brand"
        onClick={() => navigate(ROUTES.SETTINGS_SUBSECTION('privacy', 'blocked'))}
        type="button"
      >
        <span>{t('settings.privacy.blocked', 'Чёрный список')}</span>
        <span className="flex shrink-0 items-center gap-2 text-ink-2">
          {blocked.data?.length ? blocked.data.length : null}
          <Icon className="text-ink-3" name="chevronRight" size="sm" />
        </span>
      </button>
    </SettingsSection>
  );
}
