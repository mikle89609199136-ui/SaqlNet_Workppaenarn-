import { useTranslation } from 'react-i18next';
import { Avatar, Button, Icon } from '@/shared/ui';
import type { IResumableCall } from '../model/types';

export interface IResumeCallBarProps {
  call: IResumableCall;
  onResume: () => void;
  onDismiss: () => void;
}

/**
 * Звонок, из которого ушли перезагрузкой страницы (#775): он ещё идёт, и в
 * него можно вернуться. Место и вид — как у свёрнутого звонка.
 */
export function ResumeCallBar({ call, onResume, onDismiss }: IResumeCallBarProps) {
  const { t } = useTranslation();
  const peerName = call.peerName || t('call.defaultUser', 'Пользователь');

  return (
    <aside
      aria-label={t('call.resume.bar', 'Звонок продолжается')}
      className="fixed z-[9990] top-3 left-1/2 -translate-x-1/2 w-[calc(100%-1.5rem)] max-w-md bg-sheet/95 backdrop-blur-md border border-line-soft shadow-[var(--elev-2)] rounded-window pl-4 pr-2 py-2.5 flex items-center gap-3 animate-fade-in select-none"
      role="region"
    >
      <Avatar id={call.peerId} name={peerName} size="sm" src={call.peerAvatar} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-xs font-semibold text-ink">{peerName}</span>
        <span className="text-[11px] font-medium text-ink-2">
          {t('call.resume.hint', 'Звонок ещё идёт')}
        </span>
      </div>
      <Button className="shrink-0" onClick={onResume} size="sm">
        <Icon name={call.callKind === 'video' ? 'video' : 'phone'} size="xs" />
        {t('call.resume.return', 'Вернуться')}
      </Button>
      <Button
        aria-label={t('call.resume.dismiss', 'Не возвращаться')}
        className="shrink-0"
        iconOnly
        onClick={onDismiss}
        shape="round"
        size="sm"
        title={t('call.resume.dismiss', 'Не возвращаться')}
        variant="ghost"
      >
        <Icon name="cross" size="sm" />
      </Button>
    </aside>
  );
}
