import { cn } from '@/shared/lib';
import { forwardRef, type HTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import { useCallStage, useInCallStage } from '../model/callStage';

interface Props extends HTMLAttributes<HTMLDivElement> {
  stageClassName: string;
  screenClassName: string;
}

export const CallLayer = forwardRef<HTMLDivElement, Props>(function CallLayer(
  { stageClassName, screenClassName, className, ...props },
  ref
) {
  const stage = useCallStage();
  const inStage = useInCallStage();
  const layer = (
    <div
      className={cn(inStage ? stageClassName : screenClassName, className)}
      data-surface={inStage ? 'stage' : 'screen'}
      ref={ref}
      {...props}
    />
  );
  return inStage && stage ? createPortal(layer, stage) : layer;
});
