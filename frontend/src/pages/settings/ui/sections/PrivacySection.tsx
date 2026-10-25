import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { blockedUsersQuery, privacyExceptionsQuery } from '@/entities/user';
import { BlockedUsersManager } from '@/features/block-user';
import { ROUTES, isPrivacySubsection } from '@/shared/config/routes';
import { ListGroup, ListIntro, ListNavItem } from '@/shared/ui';
import type { TIconTypes } from '@/types';
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
const RULE_ICONS: Record<TPrivacyRuleSubsection, TIconTypes> = {
  'last-seen': 'eye',
  photo: 'image',
  forwards: 'forward',
  calls: 'phone',
};

export function PrivacySection() {
  const { t } = useTranslation();
  const params = useParams<{ subsection: string }>();
  const { privacy } = useSettingsData();
  const blocked = useQuery(blockedUsersQuery());
  const exceptions = useQuery(privacyExceptionsQuery());

  if (isPrivacySubsection(params.subsection)) {
    return params.subsection === 'blocked' ? (
      <BlockedUsersManager />
    ) : (
      <PrivacyRulePage subsection={params.subsection} />
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
    <>
      <ListIntro>
        {t('settings.privacy.description', 'Управляйте тем, кто видит ваши данные.')}
      </ListIntro>

      <ListGroup title={t('settings.privacy.whoSees', 'Кто видит')}>
        {(Object.keys(PRIVACY_RULES) as TPrivacyRuleSubsection[]).map((subsection) => (
          <ListNavItem
            icon={RULE_ICONS[subsection]}
            key={subsection}
            label={PRIVACY_RULES[subsection].title(t)}
            to={ROUTES.SETTINGS_SUBSECTION('privacy', subsection)}
            value={ruleSummary(subsection)}
          />
        ))}
      </ListGroup>

      {/* Чёрный список — отдельной подстраницей (#727). */}
      <ListGroup>
        <ListNavItem
          icon="ban"
          label={t('settings.privacy.blocked', 'Чёрный список')}
          to={ROUTES.SETTINGS_SUBSECTION('privacy', 'blocked')}
          value={
            blocked.data?.length
              ? blocked.data.length
              : blocked.data
                ? t('settings.privacy.blockedNone', 'пусто')
                : undefined
          }
        />
      </ListGroup>
    </>
  );
}
