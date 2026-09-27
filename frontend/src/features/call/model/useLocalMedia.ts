import { useCallback, useEffect, useRef, useState } from 'react';
import { LocalMediaManager } from './localMedia';
import type { ILocalMediaState, IStartMediaOptions, TFacingMode } from './types';

export function useLocalMedia(managerInstance?: LocalMediaManager) {
  const isOwnedManager = !managerInstance;
  const managerRef = useRef<LocalMediaManager | null>(null);
  if (!managerRef.current) {
    managerRef.current = managerInstance ?? new LocalMediaManager();
  }
  const manager = managerRef.current;

  const [state, setState] = useState<ILocalMediaState>(() => manager.getState());

  useEffect(() => {
    const unsubscribe = manager.subscribe((nextState) => {
      setState(nextState);
    });

    return () => {
      unsubscribe();
      if (isOwnedManager) {
        manager.stopMedia();
      }
    };
  }, [manager, isOwnedManager]);

  const startMedia = useCallback(
    (options?: IStartMediaOptions) => manager.startMedia(options),
    [manager]
  );

  const stopMedia = useCallback(() => {
    manager.stopMedia();
  }, [manager]);

  const toggleAudio = useCallback((enabled?: boolean) => manager.toggleAudio(enabled), [manager]);

  const toggleVideo = useCallback((enabled?: boolean) => manager.toggleVideo(enabled), [manager]);

  const switchCamera = useCallback(
    (deviceIdOrFacing?: string | TFacingMode) => manager.switchCamera(deviceIdOrFacing),
    [manager]
  );

  const switchMicrophone = useCallback(
    (deviceId: string) => manager.switchMicrophone(deviceId),
    [manager]
  );

  const enumerateDevices = useCallback(() => manager.enumerateDevices(), [manager]);

  return {
    ...state,
    manager,
    startMedia,
    stopMedia,
    toggleAudio,
    toggleVideo,
    switchCamera,
    switchMicrophone,
    enumerateDevices,
  };
}
