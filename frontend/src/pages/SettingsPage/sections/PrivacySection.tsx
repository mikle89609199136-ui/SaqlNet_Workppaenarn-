import { RadioGroup, Switch } from '@/components/ui';
import type { TLastSeenVisibility } from '@/types';
import { SettingsRow, SettingsSection } from '../SettingsControls';
import { useTranslation } from 'react-i18next';
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
  const { privacy, savePrivacy } = useSettingsData();

  const lastSeenOptions = [
    { value: 'all', label: t('settings.privacy.lastSeenAll', 'Все') },
    { value: 'contacts', label: t('settings.privacy.lastSeenContacts', 'Контакты') },
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
  );
}
