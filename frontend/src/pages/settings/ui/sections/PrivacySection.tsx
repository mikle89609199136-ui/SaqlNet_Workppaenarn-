import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { blockedUsersQuery, privacyExceptionsQuery } from '@/entities/user';
import { BlockedUsersManager } from '@/features/block-user';
import { ROUTES, isPrivacySubsection } from '@/shared/config/routes';
import { Icon } from '@/shared/ui';
import { SettingsSection } from '../SettingsControls';
import { PrivacyRulePage } from './PrivacyRulePage';
import { PRIVACY_RULES, ruleValue, type TPrivacyRuleSubsection } from './privacyRules';
import { useSettingsData } from './useSettingsData';

/**
 * «Конфиденциальность»: обзор правил, как в Telegram (#786). У каждого
 * правила — своя подстраница с выбором «Все / Никто» и исключениями по
 * людям; здесь только значение и число исключений: «Все (−2)» — двоим
 * скрыто, «Никто (+1)» — одному открыто.
 *
 * «Сообщения от незнакомых» убраны (#465): сервер их не применял, а без
 * контактов незнакомого не определить — вместо запрета плашка в новом чате.
 */
export function PrivacySection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ subsection: string }>();
  const { privacy } = useSettingsData();
  const blocked = useQuery(blockedUsersQuery());
  const exceptions = useQuery(privacyExceptionsQuery());
  const back = () => navigate(ROUTES.SETTINGS_SECTION('privacy'));

  if (isPrivacySubsection(params.subsection)) {
    return params.subsection === 'blocked' ? (
      <BlockedUsersManager onBack={back} />
    ) : (
      <PrivacyRulePage onBack={back} subsection={params.subsection} />
    );
  }

  const ruleSummary = (subsection: TPrivacyRuleSubsection) => {
    const { rule } = PRIVACY_RULES[subsection];
    const value = ruleValue(privacy, rule);
    // Показывается только список, который при этом значении действует.
    const mode = value === 'all' ? 'deny' : 'allow';
    const count = (exceptions.data ?? []).filter(
      (item) => item.rule === rule && item.mode === mode
    ).length;
    const label =
      value === 'all'
        ? t('settings.privacy.lastSeenAll', 'Все')
        : t('settings.privacy.lastSeenNobody', 'Никто');
    return count > 0 ? `${label} (${value === 'all' ? '−' : '+'}${count})` : label;
  };

  return (
    <SettingsSection
      description={t('settings.privacy.description', 'Управляйте тем, кто видит ваши данные.')}
      title={t('settings.privacy.title', 'Конфиденциальность')}
    >
      {(Object.keys(PRIVACY_RULES) as TPrivacyRuleSubsection[]).map((subsection) => (
        <OverviewRow
          key={subsection}
          label={PRIVACY_RULES[subsection].title(t)}
          onClick={() => navigate(ROUTES.SETTINGS_SUBSECTION('privacy', subsection))}
          value={ruleSummary(subsection)}
        />
      ))}

      {/* Чёрный список — отдельной подстраницей (#727). */}
      <OverviewRow
        label={t('settings.privacy.blocked', 'Чёрный список')}
        onClick={() => navigate(ROUTES.SETTINGS_SUBSECTION('privacy', 'blocked'))}
        value={blocked.data?.length ? blocked.data.length : null}
      />
    </SettingsSection>
  );
}

interface OverviewRowProps {
  label: string;
  value: ReactNode;
  onClick: () => void;
}

function OverviewRow({ label, value, onClick }: OverviewRowProps) {
  return (
    <button
      className="text-body -mx-1 flex min-h-11 w-[calc(100%+0.5rem)] items-center justify-between gap-4 rounded-control px-1 text-left text-ink transition-colors duration-fast hover:bg-sheet-2 focus-visible:outline-2 focus-visible:outline-brand"
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
