import { useProfileStore } from '@/entities/user';
import { RegisterWizard } from '@/features/auth';
import { ROUTES } from '@/shared/config/routes';
import { Navigate } from 'react-router-dom';

export function RegisterPage() {
  const token = useProfileStore((state) => state.token);

  if (token) return <Navigate replace to={ROUTES.CHATS} />;

  return <RegisterWizard />;
}
