import { useTranslation } from 'react-i18next';
import { PrivacyExceptionsEditor } from '@/features/privacy-exceptions';
import { Icon, RadioGroup } from '@/shared/ui';
import { PRIVACY_RULES, ruleValue, type TPrivacyRuleSubsection } from './privacyRules';
import { useSettingsData } from './useSettingsData';

interface Props {
  subsection: TPrivacyRuleSubsection;
  onBack: () => void;
}

/* Сервер проверяет значение и ответит 400 на незнакомое (#783), но наверх
   и так уходит только то, что предложено человеку. «Контакты» убраны
   (#726): контактов в приложении нет. */
const isVisibility = (value: string): value is 'all' | 'nobody' =>
  value === 'all' || value === 'nobody';

/**
 * Подстраница правила приватности, как в Telegram (#786): кто видит — «Все»
 * или «Никто», и под этим исключения по людям для выбранного значения.
 */
export function PrivacyRulePage({ subsection, onBack }: Props) {
  const { t } = useTranslation();
  const { privacy, savePrivacy } = useSettingsData();
  const view = PRIVACY_RULES[subsection];
  const value = ruleValue(privacy, view.rule);

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

      <h1 className="mb-4 text-[21px] leading-tight font-semibold text-ink">{view.title(t)}</h1>

      <div className="rounded-bubble border border-line bg-sheet p-5">
        <RadioGroup
          /* Подпись группы — вопрос, как в Telegram; вид — как у подписи ряда. */
          className="[&>legend]:text-body [&>legend]:mb-2 [&>legend]:text-ink"
          hint={view.hint(t)}
          label={view.question(t)}
          name={view.rule}
          onChange={(next) => isVisibility(next) && savePrivacy({ [view.rule]: next })}
          options={[
            { value: 'all', label: t('settings.privacy.lastSeenAll', 'Все') },
            { value: 'nobody', label: t('settings.privacy.lastSeenNobody', 'Никто') },
          ]}
          orientation="horizontal"
          value={value}
        />
      </div>

      <PrivacyExceptionsEditor mode={value === 'all' ? 'deny' : 'allow'} rule={view.rule} />
    </section>
  );
}
