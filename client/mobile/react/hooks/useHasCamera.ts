import { useState, useEffect } from 'react';

export function useHasCamera() {
  const [hasCamera, setHasCamera] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    async function checkCamera() {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) {
          setHasCamera(false);
          return;
        }

        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        setHasCamera(videoDevices.length > 0);
      } catch (error) {
        console.error('Camera check error:', error);
        setHasCamera(false);
      } finally {
        setIsChecking(false);
      }
    }

    checkCamera();
  }, []);

  return { hasCamera, isChecking };
}