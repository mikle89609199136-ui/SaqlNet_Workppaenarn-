import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { REACT_ROUTES } from "../../consts/routes.js";
import { STORAGE_KEYS } from "../../consts/storageKeys.js";
import { clearAuthSession } from "../../utils/clearAuthSession.js";
import services from "../../services/serviceContainer.js";

// Проверка сессии — один раз при монтировании, не на каждый переход по роутам
// (бэк уже делает silent refresh реактивно). Истёкшая сессия ловится отдельно,
// событием 'craneapp:unauthorized'.
const publicRoutes = [REACT_ROUTES.LOGIN, REACT_ROUTES.REGISTER];

export function AuthGuard() {
  const navigate = useNavigate();

  useEffect(() => {
    function handleUnauthorized() {
      clearAuthSession();
      navigate(REACT_ROUTES.LOGIN, { replace: true });
    }
    window.addEventListener("craneapp:unauthorized", handleUnauthorized);
    return () =>
      window.removeEventListener("craneapp:unauthorized", handleUnauthorized);
  }, [navigate]);

  useEffect(() => {
    const token = localStorage.getItem(STORAGE_KEYS.TOKEN);
    // намеренно window.location, а не useLocation() — нужен только путь на момент маунта
    const isPublicRoute = publicRoutes.includes(window.location.pathname);
    if (!token || isPublicRoute) return undefined;

    let cancelled = false;
    services.userService.getMe().catch(() => {
      if (cancelled) return;
      clearAuthSession();
      navigate(REACT_ROUTES.LOGIN, { replace: true });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return <Outlet />;
}
