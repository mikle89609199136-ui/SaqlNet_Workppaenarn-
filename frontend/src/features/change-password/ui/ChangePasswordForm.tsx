import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Button, Icon, Input, showToast } from '@/shared/ui';
import { PasswordRequirements } from '@/features/auth';
import { services } from '@/services/serviceContainer';
import { passwordFormSchema, type TPasswordForm } from '../model/passwordSchema';

interface Props {
  onBack: () => void;
}

export function ChangePasswordForm({ onBack }: Props) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<TPasswordForm>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmation: '' },
    mode: 'onTouched',
  });

  const newPassword = watch('newPassword');

  async function submit(values: TPasswordForm) {
    try {
      await services.authService.changePassword(values.currentPassword, values.newPassword);
      showToast('success', t('toast.passwordChanged', 'Пароль изменён'));
      onBack();
    } catch (error) {
      const code = (error as { data?: { code?: string } })?.data?.code;

      if (code === 'wrong_password') {
        setError('currentPassword', { message: 'Неверный текущий пароль' }, { shouldFocus: true });
        return;
      }

      if (code === 'weak_password') {
        setError(
          'newPassword',
          { message: t('settings.password.weak', 'Пароль не отвечает требованиям') },
          { shouldFocus: true }
        );
        return;
      }
      showToast('error', t('toast.passwordChangeFailed', 'Не удалось изменить пароль'));
    }
  }

  return (
    <section>
      <button
        className="text-caption -ml-2 mb-3 flex items-center gap-1 rounded-control px-2 py-1 text-ink-2 transition-colors duration-fast hover:text-ink focus-visible:outline-2 focus-visible:outline-brand"
        onClick={onBack}
        type="button"
      >
        <Icon className="rotate-180" name="chevronRight" size="sm" />
        {t('back', 'Назад')}
      </button>

      <header className="mb-4">
        <h1 className="mb-1 text-[21px] leading-tight font-semibold text-ink">
          {t('settings.password.title', 'Изменить пароль')}
        </h1>
        <p className="text-caption text-ink-2">
          {t('settings.password.description', 'Используйте не менее 10 символов.')}
        </p>
      </header>

      <form className="grid gap-4" onSubmit={handleSubmit(submit)}>
        <Input
          autoComplete="current-password"
          error={errors.currentPassword?.message}
          label={t('settings.password.current', 'Текущий пароль')}
          type="password"
          {...register('currentPassword')}
        />
        <div>
          <Input
            autoComplete="new-password"
            error={errors.newPassword?.message}
            label={t('settings.password.new', 'Новый пароль')}
            type="password"
            {...register('newPassword')}
          />
          {newPassword.length > 0 && <PasswordRequirements value={newPassword} />}
        </div>
        <Input
          autoComplete="new-password"
          error={errors.confirmation?.message}
          label={t('settings.password.repeat', 'Повторите новый пароль')}
          type="password"
          {...register('confirmation')}
        />

        <div className="mt-2 flex justify-end gap-2">
          <Button onClick={onBack} type="button" variant="ghost">
            {t('cancel', 'Отмена')}
          </Button>
          <Button loading={isSubmitting} type="submit">
            {t('settings.password.action', 'Изменить пароль')}
          </Button>
        </div>
      </form>
    </section>
  );
}
