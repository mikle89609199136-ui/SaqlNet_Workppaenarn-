import { useCallStore } from './callStore';

export function useCall() {
  const incomingCall = useCallStore((s) => s.incomingCall);
  const outgoingCall = useCallStore((s) => s.outgoingCall);
  const activeCall = useCallStore((s) => s.activeCall);
  const endedCall = useCallStore((s) => s.endedCall);
  const isMinimized = useCallStore((s) => s.isMinimized);
  const acceptCall = useCallStore((s) => s.acceptCall);
  const rejectCall = useCallStore((s) => s.rejectCall);
  const initiateCall = useCallStore((s) => s.initiateCall);
  const cancelCall = useCallStore((s) => s.cancelCall);
  const endCall = useCallStore((s) => s.endCall);
  const minimizeCall = useCallStore((s) => s.minimizeCall);
  const maximizeCall = useCallStore((s) => s.maximizeCall);
  const resumableCall = useCallStore((s) => s.resumableCall);
  const resumeCall = useCallStore((s) => s.resumeCall);
  const dismissResumableCall = useCallStore((s) => s.dismissResumableCall);

  return {
    incomingCall,
    outgoingCall,
    activeCall,
    endedCall,
    isMinimized,
    acceptCall,
    rejectCall,
    initiateCall,
    cancelCall,
    endCall,
    minimizeCall,
    maximizeCall,
    resumableCall,
    resumeCall,
    dismissResumableCall,
  };
}
