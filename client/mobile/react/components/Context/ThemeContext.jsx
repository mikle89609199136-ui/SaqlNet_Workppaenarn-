// src/context/ThemeContext.jsx
import React, { createContext, useContext, useEffect, useState } from 'react';

// Простые хелперы для куки
const getCookie = (name) => {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return null;
};

const setCookie = (name, value, days = 365) => {
  const date = new Date();
  date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
  document.cookie = `${name}=${value};expires=${date.toUTCString()};path=/;SameSite=Lax`;
};

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    // 1. Проверяем cookie
    const savedCookie = getCookie('app_theme');
    if (savedCookie) return savedCookie;

    // 2. Если куки нет, можно проверить системную тему устройства
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
    return 'dark'; // Дефолтная тема
  });

  useEffect(() => {
    // При изменении темы ставим дата-атрибут на <html> и записываем в куки
    document.documentElement.setAttribute('data-theme', theme);
    setCookie('app_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);