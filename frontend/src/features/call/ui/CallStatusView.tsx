import { useTranslation } from 'react-i18next';
import { CallButton } from './CallButton';
import { CallSurface } from './CallSurface';
import { RingingAvatar } from './RingingAvatar';

interface Props {
  peerId?: string | null;
  peerName: string;
  peerAvatar?: string | null;
  status: string;
  ringing?: boolean;
  onCancel?: () => void;
  cancelDisabled?: boolean;
}

export function CallStatusView({
  peerId,
  peerName,
  peerAvatar,
  status,
  ringing = false,
  onCancel,
  cancelDisabled = false,
}: Props) {
  const { t } = useTranslation();

  return (
    <CallSurface
      aria-label={t('call.activeDialog', 'Активный звонок')}
      className="items-center justify-between px-6 pt-[calc(120px+env(safe-area-inset-top,0px))] pb-[calc(48px+env(safe-area-inset-bottom,0px))] text-center"
      glowSeed={peerId || peerName}
      role="dialog"
    >
      <div className="flex flex-col items-center gap-5">
        <RingingAvatar id={peerId || peerName} name={peerName} ringing={ringing} src={peerAvatar} />
        <div className="flex flex-col gap-1">
          <h2 className="text-[26px] leading-tight font-semibold">{peerName}</h2>
          <p aria-live="polite" className="text-[15px] text-on-scrim/75">
            {status}
          </p>
        </div>
      </div>
      {onCancel && (
        <CallButton
          aria-label={t('call.cancel', 'Отменить')}
          caption={t('call.cancel', 'Отменить')}
          disabled={cancelDisabled}
          icon="phone"
          iconClassName="rotate-[135deg]"
          onClick={onCancel}
          tone="reject"
        />
      )}
    </CallSurface>
  );
}
