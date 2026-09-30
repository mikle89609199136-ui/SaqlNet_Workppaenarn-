import { useProfileStore } from '@/entities/user';
import { RegisterWizard } from '@/features/auth';
import { ROUTES } from '@/shared/config/routes';
import { Navigate } from 'react-router-dom';

export function RegisterPage() {
  const signedIn = useProfileStore((state) => state.isAuth);

  if (signedIn) return <Navigate replace to={ROUTES.CHATS} />;

  return <RegisterWizard />;
}
