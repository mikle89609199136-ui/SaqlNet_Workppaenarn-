import React from 'react';
import { createRoot } from 'react-dom/client';
import { RegisterPage } from './components/Auth/RegisterPage.jsx';
import './styles/app.css';

function translate(key, fallback, vars) {
  return window.i18n?.t(key, vars) || fallback;
}

createRoot(document.getElementById('registerRoot')).render(
  <React.StrictMode>
    <RegisterPage redirectPath="/chats" t={translate} />
  </React.StrictMode>
);
