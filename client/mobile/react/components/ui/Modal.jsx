import React from "react";

export const Modal = ({ children }) => {
  return <div className="modal-backdrop">{children}</div>;
};
