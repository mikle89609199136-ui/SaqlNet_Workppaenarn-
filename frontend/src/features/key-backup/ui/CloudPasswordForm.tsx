import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { services } from '@/services/serviceContainer';
import { Button } from '@/shared/ui';
import {
  cloudPasswordFormSchema,
  cloudPasswordScore,
  type TCloudPasswordForm,
} from '../model/cloudPasswordSchema';
import { CloudPasswordInput } from './CloudPasswordInput';

interface Props {
  submitLabel: string;
  onSubmit: (password: string) => Promise<void>;
}

const SCORE_COLORS = [
  'var(--color-danger)',
  'color-mix(in srgb, var(--color-danger) 50%, var(--color-warn))',
  'var(--color-warn)',
  'var(--color-ok)',
];

/**
 * Новый облачный пароль с повтором.
 *
 * Общая для первой настройки и смены пароля: отличаются они только тем,
 * что делают с паролем после проверки.
 */
export function CloudPasswordForm({ submitLabel, onSubmit }: Props) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<TCloudPasswordForm>({
    resolver: zodResolver(cloudPasswordFormSchema),
    defaultValues: { password: '', confirmation: '' },
    mode: 'onTouched',
  });

  const score = cloudPasswordScore(watch('password'));

  async function submit(values: TCloudPasswordForm) {
    if (await services.cryptoService.isLoginPassword(values.password)) {
      setError(
        'password',
        {
          message: t(
            'keyBackup.password.sameAsLogin',
            'Не используйте пароль входа: его знает сервер, а облачный пароль должны знать только вы'
          ),
        },
        { shouldFocus: true }
      );
      return;
    }

    try {
      await onSubmit(values.password);
    } catch (error) {
      setError('password', {
        message:
          (error as Error).message || t('keyBackup.password.failed', 'Не удалось сохранить пароль'),
      });
    }
  }

  return (
    <form className="grid gap-4 text-left" noValidate onSubmit={handleSubmit(submit)}>
      <div>
        <CloudPasswordInput
          aria-describedby={errors.password ? undefined : 'cloud-password-hint'}
          autoComplete="new-password"
          error={errors.password?.message}
          label={t('keyBackup.password.label', 'Облачный пароль')}
          {...register('password')}
        />
        {/* По макету (#827): полоска стойкости сразу под полем, подсказка —
            под полоской. Ошибка поля её заменяет. */}
        <div aria-hidden className="mt-2 h-1 overflow-hidden rounded-pill bg-divider">
          <div
            className="h-full transition-all duration-[var(--transition-duration-panel)]"
            style={{
              background: score > 0 ? SCORE_COLORS[score - 1] : 'transparent',
              width: `${(score / SCORE_COLORS.length) * 100}%`,
            }}
          />
        </div>
        {!errors.password && (
          <p className="m-0 mt-1.5 text-meta leading-[1.4] text-ink-3" id="cloud-password-hint">
            {t(
              'keyBackup.password.hint',
              'Не короче 12 символов. Фраза из нескольких слов — отличный вариант.'
            )}
          </p>
        )}
      </div>

      <CloudPasswordInput
        autoComplete="new-password"
        error={errors.confirmation?.message}
        label={t('keyBackup.password.confirm', 'Повторите облачный пароль')}
        {...register('confirmation')}
      />

      <Button className="mt-2 w-full" loading={isSubmitting} type="submit">
        {submitLabel}
      </Button>
    </form>
  );
}
