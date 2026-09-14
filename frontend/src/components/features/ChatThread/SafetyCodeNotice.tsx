import { acknowledgeIdentityChange } from '@/crypto/securityNotices';
import { useSecurityNotice } from '@/hooks';
import { membersQuery } from '@/entities/chat';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

interface Props {
  chatId: string;
}

/**
 * Отметка о смене ключа собеседника.
 *
 * Ключ собеседника выдаёт сервер, поэтому подменить его — самый простой
 * способ встать между двумя людьми и читать переписку. Отличить подмену от
 * честной смены устройства нельзя ничем: выглядит это одинаково. Решение
 * остаётся за человеком, а приложение обязано о смене сказать — молчание
 * здесь и есть та дыра, ради которой подмену затевают.
 *
 * Куда идти дальше, отметка не говорит: кода безопасности в профиле
 * больше нет, и отправлять человека искать несуществующее хуже, чем
 * промолчать. Сам факт смены ключа сказать всё равно надо.
 */
export function SafetyCodeNotice({ chatId }: Props) {
  const { t } = useTranslation();
  const { data: members = [] } = useQuery(membersQuery(chatId));
  const notice = useSecurityNotice(members.map((member) => member.id));

  if (!notice) return null;

  const who = members.find((member) => member.id === notice.userId);
  // Имя ставится подлежащим: так оно не требует склонения, а склонять его
  // подстановкой в строку перевода — верный способ получить «код Борис».
  const name = who?.firstName || who?.username || t('interlocutor', 'Собеседник');

  return (
    <div className="safety-code-notice" role="status">
      <span>{t('safetyCodeChanged', '{{name}} сменил ключи шифрования', { name })}</span>

      <button onClick={() => void acknowledgeIdentityChange(notice.userId)} type="button">
        {t('understood', 'Понятно')}
      </button>
    </div>
  );
}
