import { router } from "@/configs";
import { RouterProvider } from "react-router-dom";

import { NotificationManager } from "./components/layouts/NotificationManager.js";
import { CallOverlay, CallProvider } from "./components/index.js";

export function App() {
  return (
    <>
      <CallProvider>
        <CallOverlay />
        <RouterProvider router={router} />
        <NotificationManager />
      </CallProvider>
    </>
  );
}
