import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui';
import { useBlockFlow } from '../model/useBlockFlow';

interface Props {
  userId: string;
  name: string;
}

/**
 * «Заблокировать» / «Разблокировать» в профиле и в плашке нового чата
 * (#727, #465). Блокировка — с подтверждением: она обрывает переписку и
 * звонки; снятие — сразу.
 */
export function BlockUserButton({ userId, name }: Props) {
  const { t } = useTranslation();
  const flow = useBlockFlow();

  if (flow.isBlocked(userId)) {
    return (
      <Button disabled={flow.isUnblocking} onClick={() => flow.unblock(userId)} variant="secondary">
        {t('unblock', 'Разблокировать')}
      </Button>
    );
  }

  return (
    <>
      <Button
        disabled={flow.isListLoading}
        onClick={() => flow.requestBlock(userId, name)}
        variant="danger"
      >
        {t('block', 'Заблокировать')}
      </Button>
      {flow.dialog}
    </>
  );
}
