import { useProfileStore } from '@/store';
import { useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useRealtimeSocket } from './useRealtimeSocket';

export function useTypingIndicator() {
  const lastSentAtRef = useRef(0);
  const userId = useProfileStore((store) => store.user?.id);
  const { socket } = useRealtimeSocket();
  const { chatId } = useParams<{ chatId: string }>();

  return function sendTyping() {
    if (!chatId || !socket?.isConnected) return;

    const now = Date.now();
    if (now - lastSentAtRef.current < 1500) return;
    lastSentAtRef.current = now;

    try {
      socket.send({ type: 'typing', chatId, userId });
    } catch (err) {
      console.warn('Failed to send typing event', err);
    }
  };
}
