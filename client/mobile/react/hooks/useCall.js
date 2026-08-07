import { createContext, useContext } from "react";

export const CallContext = createContext(null);

export function useCall() {
  return useContext(CallContext);
}