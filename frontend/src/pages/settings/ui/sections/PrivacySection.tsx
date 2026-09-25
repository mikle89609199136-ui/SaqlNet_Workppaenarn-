import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon, RadioGroup, Switch } from '@/shared/ui';
import { ROUTES, isPrivacySubsection } from '@/shared/config/routes';
import { BlockedUsersList, useBlockedUsers } from '@/features/blocked-users';
import type { TLastSeenVisibility } from '@/entities/user';
import { SettingsRow, SettingsSection } from '../SettingsControls';
import { useSettingsData } from './useSettingsData';

/* Три варианта показаны сразу, а не спрятаны в список: выбор из трёх
   читается одним взглядом, и лишнее нажатие ради этого не нужно. */
const LAST_SEEN_VALUES = ['all', 'contacts', 'nobody'] as const;

/* Сервер значение не проверяет: `{"lastSeen": 123}` сохранится и вернёт
   200 (#439). Поэтому допустимость решает клиент — наверх уходит только
   то, что есть в списке. */
function isLastSeenVisibility(value: string): value is TLastSeenVisibility {
  return (LAST_SEEN_VALUES as readonly string[]).includes(value);
}

export function PrivacySection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ subsection: string }>();
  const { privacy, savePrivacy } = useSettingsData();
  const { blockedCount } = useBlockedUsers();

  const isBlockedView = isPrivacySubsection(params.subsection) && params.subsection === 'blocked';

  if (isBlockedView) {
    return <BlockedUsersList onBack={() => navigate(ROUTES.SETTINGS_SECTION('privacy'))} />;
  }

  const lastSeenOptions = [
    { value: 'all', label: t('settings.privacy.lastSeenAll', 'Все') },
    { value: 'contacts', label: t('settings.privacy.lastSeenContacts', 'Контакты') },
    { value: 'nobody', label: t('settings.privacy.lastSeenNobody', 'Никто') },
  ];

  return (
    <>
      <SettingsSection
        description={t('settings.privacy.description', 'Управляйте тем, кто видит ваши данные.')}
        title={t('settings.privacy.title', 'Конфиденциальность')}
      >
        {/* Подпись группы рисует она сама — это legend внутри fieldset.
            Подменять его подписью ряда значило бы разорвать связь для
            диктора, поэтому здесь группа стоит без обёртки. */}
        <RadioGroup
          /* Подпись группы приводится к виду подписи ряда: рядом стоит
             «Сообщения от незнакомых», и два названия настроек не должны
             выглядеть по-разному. Компонент рисует legend как подпись поля,
             поэтому вид задаётся здесь, а не внутри него. */
          className="[&>legend]:text-body [&>legend]:mb-2 [&>legend]:text-ink"
          label={t('settings.privacy.lastSeen', 'Последняя активность')}
          name="lastSeen"
          onChange={(value) => isLastSeenVisibility(value) && savePrivacy({ lastSeen: value })}
          options={lastSeenOptions}
          orientation="horizontal"
          value={privacy.lastSeen ?? 'all'}
        />

        {/* Умолчание — «разрешено»: отсутствие настройки не должно выглядеть
            как запрет, которого человек не ставил. */}
        <SettingsRow
          controlId="setting-strangers"
          label={t('settings.privacy.strangers', 'Сообщения от незнакомых')}
        >
          <Switch
            checked={privacy.messagesFromStrangers !== false}
            id="setting-strangers"
            onChange={(event) => savePrivacy({ messagesFromStrangers: event.target.checked })}
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        description={t(
          'settings.privacy.blockedUsersDescription',
          'Пользователи в чёрном списке не могут писать вам и совершать звонки.'
        )}
        title={t('settings.privacy.blockedTitle', 'Чёрный список')}
      >
        <button
          className="text-body -m-2 flex items-center justify-between gap-4 rounded-control p-2 text-left text-ink transition-colors duration-fast hover:bg-sheet-2 focus-visible:outline-2 focus-visible:outline-brand"
          onClick={() => navigate(ROUTES.SETTINGS_SUBSECTION('privacy', 'blocked'))}
          type="button"
        >
          <span className="min-w-0 font-medium">
            {t('settings.privacy.blockedUsers', 'Заблокированные пользователи')}
          </span>
          <span className="flex shrink-0 items-center gap-2 text-ink-2">
            {blockedCount > 0 && (
              <span className="text-caption rounded-full bg-sheet-2 px-2.5 py-0.5 font-semibold text-ink-2">
                {blockedCount}
              </span>
            )}
            <Icon className="text-ink-3" name="chevronRight" size="sm" />
          </span>
        </button>
      </SettingsSection>
    </>
  );
}
