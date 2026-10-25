import { REACT_ROUTES } from '@/shared/config';
import { useProfileStore } from '@/entities/user';
import { clearAuthSession, signOut } from '@/features/auth';
import { KeyBackupGate } from '@/features/key-backup';
import { QrLoginPanel } from '@/features/qr-login';
import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';

export function AuthGuard() {
  const navigate = useNavigate();

  useEffect(() => {
    function handleUnauthorized() {
      if (!useProfileStore.getState().isAuth) return;

      clearAuthSession();
      const from = window.location.pathname + window.location.search;
      navigate(`${REACT_ROUTES.LOGIN}?from=${encodeURIComponent(from)}`, {
        replace: true,
      });
    }
    window.addEventListener('craneapp:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('craneapp:unauthorized', handleUnauthorized);
  }, [navigate]);

  return (
    <KeyBackupGate
      onSignOut={signOut}
      renderQrLogin={(onKey) => <QrLoginPanel onConfirmed={({ masterKey }) => onKey(masterKey)} />}
    >
      <Outlet />
    </KeyBackupGate>
  );
}
