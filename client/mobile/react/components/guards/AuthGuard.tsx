import { REACT_ROUTES } from "@/consts";
import { useProfileStore } from "@/store";
import { clearAuthSession } from "@/utils";
import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router-dom";

export function AuthGuard() {
  const navigate = useNavigate();

  useEffect(() => {
    function handleUnauthorized() {
      if (!useProfileStore.getState().token) return;

      clearAuthSession();
      const from = window.location.pathname + window.location.search;
      navigate(`${REACT_ROUTES.LOGIN}?from=${encodeURIComponent(from)}`, {
        replace: true,
      });
    }
    window.addEventListener("craneapp:unauthorized", handleUnauthorized);
    return () =>
      window.removeEventListener("craneapp:unauthorized", handleUnauthorized);
  }, [navigate]);

  return <Outlet />;
}
