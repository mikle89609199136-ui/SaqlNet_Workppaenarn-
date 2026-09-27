import { useTranslation } from 'react-i18next';
import { PrivacyExceptionsEditor } from '@/features/privacy-exceptions';
import { ListGroup, ListRadioItem } from '@/shared/ui';
import { PRIVACY_RULES, ruleValue, type TPrivacyRuleSubsection } from './privacyRules';
import { useSettingsData } from './useSettingsData';

interface Props {
  subsection: TPrivacyRuleSubsection;
}

/* Сервер проверяет значение и ответит 400 на незнакомое (#783), но наверх
   и так уходит только то, что предложено человеку. «Контакты» убраны
   (#726): контактов в приложении нет. */
const VISIBILITY = ['all', 'nobody'] as const;

/**
 * Подстраница правила приватности, как в Telegram (#786): кто видит — «Все»
 * или «Никто», и под этим исключения по людям для выбранного значения.
 * Заголовок и «назад» — в шапке раздела настроек (#828).
 */
export function PrivacyRulePage({ subsection }: Props) {
  const { t } = useTranslation();
  const { privacy, savePrivacy } = useSettingsData();
  const view = PRIVACY_RULES[subsection];
  const value = ruleValue(privacy, view.rule);
  const labels = {
    all: t('settings.privacy.lastSeenAll', 'Все'),
    nobody: t('settings.privacy.lastSeenNobody', 'Никто'),
  };

  return (
    <>
      {/* Подпись группы — вопрос, как в Telegram; пояснение — под ней. */}
      <ListGroup note={view.hint(t)} radiogroup title={view.question(t)}>
        {VISIBILITY.map((option) => (
          <ListRadioItem
            checked={value === option}
            key={option}
            label={labels[option]}
            onSelect={() => option !== value && savePrivacy({ [view.rule]: option })}
          />
        ))}
      </ListGroup>

      <PrivacyExceptionsEditor mode={value === 'all' ? 'deny' : 'allow'} rule={view.rule} />
    </>
  );
}
