import { Avatar } from '@/shared/ui';
import { cn } from '@/shared/lib';

interface Props {
  id: string;
  name?: string | null;
  src?: string | null;
  size?: 'md' | 'call';
  ringing?: boolean;
}

const RING =
  'pointer-events-none absolute inset-0 rounded-pill border-2 border-on-scrim/45 animate-[call-ring_1.8s_ease-out_infinite] motion-reduce:hidden';

export function RingingAvatar({ id, name, src, size = 'call', ringing = true }: Props) {
  return (
    <span
      className={cn(
        'relative inline-flex rounded-pill',
        !ringing &&
          size === 'call' &&
          'shadow-[0_0_0_6px_color-mix(in_srgb,var(--color-on-scrim)_8%,transparent)]'
      )}
    >
      {ringing && (
        <>
          <span aria-hidden="true" className={RING} />
          <span aria-hidden="true" className={cn(RING, '[animation-delay:900ms]')} />
        </>
      )}
      <Avatar id={id} name={name ?? undefined} size={size} src={src} />
    </span>
  );
}
