import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Button, Input, showToast } from '@/shared/ui';
import { PasswordRequirements } from '@/shared/ui';
import { services } from '@/services/serviceContainer';
import { createPasswordFormSchema, type TPasswordForm } from '../model/passwordSchema';

interface Props {
  /** Куда вернуться после смены пароля. */
  onBack: () => void;
}

export function ChangePasswordForm({ onBack }: Props) {
  const { t } = useTranslation();
  /* Сообщения схемы — на языке интерфейса: сменился язык — новая схема. */
  const schema = useMemo(() => createPasswordFormSchema(t), [t]);
  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<TPasswordForm>({
    resolver: zodResolver(schema),
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
        setError(
          'currentPassword',
          { message: t('validation.currentPasswordWrong', 'Неверный текущий пароль') },
          { shouldFocus: true }
        );
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

  /* Заголовок и «назад» — в шапке раздела настроек (#828). У каждого
     поля свой глазок: его даёт Input с type="password". */
  return (
    <section className="rounded-dialog bg-card p-5">
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

        <div className="flex justify-end">
          <Button loading={isSubmitting} type="submit">
            {t('settings.password.action', 'Изменить пароль')}
          </Button>
        </div>
      </form>
    </section>
  );
}
