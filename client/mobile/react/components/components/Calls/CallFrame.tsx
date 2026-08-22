import { useEffect, useRef } from "react";
import { useCallStore } from "@/store";

interface ICallFrameProps {
  src: string;
}

export function CallFrame({ src }: ICallFrameProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    useCallStore.getState().attachCallFrame(frameRef.current);
    return () => useCallStore.getState().attachCallFrame(null);
  }, []);

  return (
    <iframe ref={frameRef} src={src} title="call" allow="camera; microphone" />
  );
}
