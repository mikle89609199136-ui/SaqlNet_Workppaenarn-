import { RadioGroup, Switch } from '@/shared/ui';
import type { TPrivacyVisibility } from '@/types';
import { SettingsRow, SettingsSection } from '../SettingsControls';
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

/* Подпись группы приводится к виду подписи ряда: рядом стоит
   «Сообщения от незнакомых», и названия настроек не должны выглядеть
   по-разному. Компонент рисует legend как подпись поля, поэтому вид
   задаётся здесь, а не внутри него. */
const GROUP_LABEL = '[&>legend]:text-body [&>legend]:mb-2 [&>legend]:text-ink';

export function PrivacySection() {
  const { t } = useTranslation();
  const { privacy, savePrivacy } = useSettingsData();

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
  );
}
