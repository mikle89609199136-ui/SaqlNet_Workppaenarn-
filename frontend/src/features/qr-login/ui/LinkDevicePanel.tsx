import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { services } from '@/services/serviceContainer';
import {
  parseQrLink,
  readBackupState,
  subscribeToBackupState,
  type IQrLink,
} from '@/shared/crypto';
import { Banner, Button, Icon, Input, Spinner } from '@/shared/ui';
import { QrScanner } from './QrScanner';

interface Props {
  /** Ссылка, по которой открыли страницу `/link`. */
  initialLink?: string | null;
  onDone?: () => void;
}

interface IRequestDetails {
  deviceName: string;
  userAgent: string;
  createdAt: number;
}

type TStage = 'input' | 'checking' | 'confirm' | 'sending' | 'done';

type TInspection =
  { ok: true; link: IQrLink; details: IRequestDetails } | { ok: false; error: string };

/**
 * Подтвердить вход нового устройства (#745).
 *
 * Прежде чем отдать ключ, человеку показывают, какое устройство просит
 * войти: код могли подсунуть — «отсканируйте, пожалуйста, мне нужно
 * войти». Ключ из QR сверяется с тем, что знает сервер: расхождение
 * значит, что код подменён, и подтверждать нельзя.
 */
export function LinkDevicePanel({ initialLink, onDone }: Props) {
  const { t } = useTranslation();
  const [stage, setStage] = useState<TStage>(initialLink ? 'checking' : 'input');
  const [scanning, setScanning] = useState(false);
  const [text, setText] = useState('');
  const [link, setLink] = useState<IQrLink | null>(null);
  const [details, setDetails] = useState<IRequestDetails | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Подписка нужна ради перерисовки: копию могут открыть, пока экран открыт.
  const backup = useSyncExternalStore(subscribeToBackupState, readBackupState, readBackupState);
  const unlocked = backup.status === 'ready';

  /** Разобрать код и спросить сервер, какое устройство просит войти. */
  async function inspect(raw: string): Promise<TInspection> {
    const parsed = parseQrLink(raw, window.location.origin);
    if (!parsed)
      return { ok: false, error: t('qrLogin.invalidLink', 'Это не код входа в CraneApp') };

    try {
      const request = await services.authService.getQrRequest(parsed.token);

      return request.publicKey === parsed.publicKey
        ? { ok: true, link: parsed, details: request }
        : {
            ok: false,
            error: t(
              'qrLogin.keyMismatch',
              'Код не совпадает с запросом входа — не подтверждайте его'
            ),
          };
    } catch {
      return {
        ok: false,
        error: t(
          'qrLogin.expired',
          'Код истёк или уже использован. Обновите его на новом устройстве.'
        ),
      };
    }
  }

  function apply(result: TInspection) {
    if (result.ok) {
      setLink(result.link);
      setDetails(result.details);
      setStage('confirm');
      return;
    }
    setError(result.error);
    setStage('input');
  }

  async function check(raw: string) {
    setScanning(false);
    setError(null);
    setStage('checking');
    apply(await inspect(raw));
  }

  useEffect(() => {
    if (!initialLink) return undefined;

    let cancelled = false;
    // Проверяем только ссылку, с которой открыли страницу.
    void inspect(initialLink).then((result) => {
      if (!cancelled) apply(result);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLink]);

  async function confirm() {
    if (!link) return;

    setStage('sending');
    setError(null);
    try {
      await services.authService.confirmQrLogin(
        link.token,
        await services.cryptoService.sealMasterKeyForLink(link)
      );
      setStage('done');
    } catch {
      setError(
        t(
          'qrLogin.confirmFailed',
          'Не удалось подтвердить вход. Обновите код и попробуйте ещё раз.'
        )
      );
      setStage('input');
    }
  }

  if (!unlocked) {
    return (
      <Banner icon="lock" tone="warn">
        {t(
          'qrLogin.lockedHere',
          'На этом устройстве резервная копия ещё не открыта — подключать с него другие нельзя. Сначала введите облачный пароль.'
        )}
      </Banner>
    );
  }

  if (stage === 'done') {
    return (
      <div className="grid gap-4 text-center">
        <Icon className="mx-auto size-10 text-ok" name="checkCircle" />
        <p className="text-body text-ink">
          {t('qrLogin.done', 'Готово: новое устройство вошло, история переписки уже там.')}
        </p>
        {onDone && (
          <Button className="w-full" onClick={onDone} variant="secondary">
            {t('done', 'Готово')}
          </Button>
        )}
      </div>
    );
  }

  if ((stage === 'confirm' || stage === 'sending') && details) {
    return (
      <div className="grid gap-4 text-left">
        <p className="text-body text-ink">
          {t('qrLogin.confirmQuestion', 'Войти в ваш аккаунт на этом устройстве?')}
        </p>
        <div className="rounded-field border border-line bg-sheet-2 p-4">
          <strong className="text-body block text-ink">
            {details.deviceName || details.userAgent}
          </strong>
          <span className="text-caption text-ink-2">
            {new Date(details.createdAt).toLocaleString()}
          </span>
        </div>
        <Banner icon="warning" tone="warn">
          {t(
            'qrLogin.phishingWarning',
            'Подтверждайте, только если этот код открыли вы сами. Никогда не сканируйте код по чужой просьбе: так получают доступ к вашей переписке.'
          )}
        </Banner>
        <Button className="w-full" loading={stage === 'sending'} onClick={confirm}>
          {t('qrLogin.confirm', 'Подтвердить вход')}
        </Button>
        <Button
          className="w-full"
          disabled={stage === 'sending'}
          onClick={() => {
            setStage('input');
            setDetails(null);
            setLink(null);
          }}
          variant="ghost"
        >
          {t('cancel', 'Отмена')}
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 text-left">
      {error && (
        <Banner icon="warning" tone="warn">
          {error}
        </Banner>
      )}

      {stage === 'checking' ? (
        <div className="flex justify-center py-6">
          <Spinner label={t('qrLogin.checking', 'Проверяем код…')} size="md" />
        </div>
      ) : scanning ? (
        <>
          <QrScanner onResult={check} />
          <Button className="w-full" onClick={() => setScanning(false)} variant="ghost">
            {t('cancel', 'Отмена')}
          </Button>
        </>
      ) : (
        <>
          <Button className="w-full" onClick={() => setScanning(true)}>
            <Icon name="camera" size="sm" />
            {t('qrLogin.scan', 'Сканировать код')}
          </Button>
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void check(text);
            }}
          >
            <Input
              autoCapitalize="none"
              autoCorrect="off"
              label={t('qrLogin.pasteLabel', 'Или вставьте ссылку из-под кода')}
              onChange={(event) => setText(event.target.value)}
              placeholder="https://…/link#…"
              value={text}
            />
            <Button className="w-full" disabled={!text.trim()} type="submit" variant="secondary">
              {t('qrLogin.checkLink', 'Проверить')}
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
