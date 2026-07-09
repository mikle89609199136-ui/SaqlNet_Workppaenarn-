import React from 'react';
import { createRoot } from 'react-dom/client';
import { RateLimitPage } from './components/RateLimit/RateLimitPage.jsx';
import './styles/app.css';

function getRetryAfter() {
  const params = new URLSearchParams(window.location.search);
  const parsedValue = Number.parseInt(params.get('retry') || '60', 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 60;
}

function rememberPreviousUrl() {
  if (document.referrer && !document.referrer.includes('rate-limit')) {
    window.sessionStorage.setItem('crane_pre_ratelimit_url', document.referrer);
  }
}

function goBack() {
  const previousUrl = window.sessionStorage.getItem('crane_pre_ratelimit_url');
  if (previousUrl) {
    window.location.href = previousUrl;
    return;
  }

  window.history.back();
}

function translate(key, fallback, vars) {
  return window.i18n?.t(key, vars) || fallback;
}

rememberPreviousUrl();

createRoot(document.getElementById('rateLimitRoot')).render(
  <React.StrictMode>
    <RateLimitPage retryAfter={getRetryAfter()} onBack={goBack} t={translate} />
  </React.StrictMode>
);
