import { Outlet } from "react-router-dom";
import { ToastStack } from "@/components/ui";

export const RootLayout = () => {
  return (
    <>
      <ToastStack />
      <Outlet />
    </>
  );
};
