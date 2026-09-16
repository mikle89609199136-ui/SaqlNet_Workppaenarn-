import { useProfileStore } from '@/entities/user';
import { LoginForm } from '@/features/auth';
import { ROUTES } from '@/shared/config/routes';
import { AuthLayout } from '@/shared/ui';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router-dom';

export function LoginPage() {
  const token = useProfileStore((state) => state.token);
  const { t } = useTranslation();

  /* Уже вошли — на странице входа делать нечего. */
  if (token) return <Navigate replace to={ROUTES.CHATS} />;

  return (
    <AuthLayout
      footer={
        <>
          {t('noAccount', 'Нет аккаунта?')}{' '}
          <Link className="text-brand hover:underline" to={ROUTES.REGISTER}>
            {t('registerAction', 'Зарегистрироваться')}
          </Link>
        </>
      }
      subtitle={t('loginSubtitle', 'Войдите в аккаунт')}
      title="CraneApp"
    >
      <LoginForm />
    </AuthLayout>
  );
}
