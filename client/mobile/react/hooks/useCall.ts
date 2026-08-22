import { useCallStore } from "@/store";

export function useCall() {
  const incomingCall = useCallStore((s) => s.incomingCall);
  const activeCall = useCallStore((s) => s.activeCall);
  const isMinimized = useCallStore((s) => s.isMinimized);
  const acceptCall = useCallStore((s) => s.acceptCall);
  const rejectCall = useCallStore((s) => s.rejectCall);
  const initiateCall = useCallStore((s) => s.initiateCall);
  const endCall = useCallStore((s) => s.endCall);
  const minimizeCall = useCallStore((s) => s.minimizeCall);
  const maximizeCall = useCallStore((s) => s.maximizeCall);

  return {
    incomingCall,
    activeCall,
    isMinimized,
    acceptCall,
    rejectCall,
    initiateCall,
    endCall,
    minimizeCall,
    maximizeCall,
  };
}
