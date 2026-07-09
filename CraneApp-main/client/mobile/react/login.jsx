import React from 'react';
import { createRoot } from 'react-dom/client';
import { LoginPage } from './components/Auth/LoginPage.jsx';
import './styles/app.css';

function translate(key, fallback, vars) {
  return window.i18n?.t(key, vars) || fallback;
}

createRoot(document.getElementById('loginRoot')).render(
  <React.StrictMode>
    <LoginPage redirectPath="/chats" t={translate} />
  </React.StrictMode>
);
