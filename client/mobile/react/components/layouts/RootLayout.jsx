import { Outlet } from "react-router-dom";
import { ToastStack } from "../ui/ToastStack";

export const RootLayout = () => {
  return (
    <>
      <ToastStack />
      <Outlet />
    </>
  );
};
