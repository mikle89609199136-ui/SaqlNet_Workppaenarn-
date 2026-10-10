import { avatarColor } from '@/shared/ui';
import { cn } from '@/shared/lib';
import { forwardRef, type HTMLAttributes } from 'react';
import { useInCallStage } from '../model/callStage';
import { CallLayer } from './CallLayer';

interface Props extends HTMLAttributes<HTMLDivElement> {
  glowSeed?: string;
}

export const CallSurface = forwardRef<HTMLDivElement, Props>(function CallSurface(
  { glowSeed, className, style, ...props },
  ref
) {
  const inStage = useInCallStage();
  const ground = `color-mix(in srgb, var(--color-call-ground) ${inStage ? 86 : 100}%, transparent)`;
  const background =
    glowSeed !== undefined
      ? `radial-gradient(120% 90% at 50% 32%, color-mix(in srgb, ${avatarColor(glowSeed)} 73%, ${ground}) 0%, ${ground} 68%)`
      : ground;

  return (
    <CallLayer
      className={cn('flex flex-col overflow-hidden text-on-scrim select-none', className)}
      ref={ref}
      screenClassName="fixed inset-0 z-[9999]"
      stageClassName="absolute inset-0 z-40 backdrop-blur-md"
      style={{ background, ...style }}
      {...props}
    />
  );
});
