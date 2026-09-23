import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banner } from '@/shared/ui';

interface Props {
  onResult: (text: string) => void;
}

interface IBarcodeDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

type TBarcodeDetectorCtor = new (options: { formats: string[] }) => IBarcodeDetector;

const SCAN_INTERVAL_MS = 250;

/**
 * Сканер QR камерой.
 *
 * `BarcodeDetector` есть не везде — например, его нет в Chrome на Windows.
 * Там кадр разбирает jsQR: он грузится лениво, только когда сканер открыт.
 */
export function QrScanner({ onResult }: Props) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const resultRef = useRef(onResult);

  useEffect(() => {
    resultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        const video = videoRef.current;
        if (!video || stopped) return;

        video.srcObject = stream;
        await video.play();

        const Detector = (window as unknown as { BarcodeDetector?: TBarcodeDetectorCtor })
          .BarcodeDetector;
        const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;
        const jsQR = detector ? null : (await import('jsqr')).default;
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });

        const scan = async () => {
          if (stopped || !context) return;

          if (video.videoWidth > 0) {
            let text: string | undefined;

            if (detector) {
              text = (await detector.detect(video).catch(() => []))[0]?.rawValue;
            } else if (jsQR) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              context.drawImage(video, 0, 0);
              const frame = context.getImageData(0, 0, canvas.width, canvas.height);
              text = jsQR(frame.data, frame.width, frame.height)?.data;
            }

            if (text) {
              resultRef.current(text);
              return;
            }
          }

          timer = setTimeout(scan, SCAN_INTERVAL_MS);
        };

        void scan();
      } catch {
        if (!stopped) setFailed(true);
      }
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  if (failed) {
    return (
      <Banner icon="warning" tone="warn">
        {t(
          'qrLogin.cameraUnavailable',
          'Камера недоступна. Скопируйте ссылку под кодом на новом устройстве и вставьте её сюда.'
        )}
      </Banner>
    );
  }

  return (
    <video
      aria-label={t('qrLogin.camera', 'Камера для сканирования кода')}
      className="aspect-square w-full rounded-field bg-sheet-2 object-cover"
      muted
      playsInline
      ref={videoRef}
    />
  );
}
