import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';

// Global Scripts
import '../scripts/i18n.js';
import '../scripts/apple-emoji.js';

// Styles
import './styles/tailwind.css';

createRoot(document.getElementById('appRoot')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
