import { createContext, useContext, useState, useEffect } from 'react';
import ru from './ru.json';
import en from './en.json';

const translations = { ru, en };

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  // Загружаем язык из localStorage или по умолчанию 'ru'
  const [lang, setLang] = useState(() => localStorage.getItem('app_lang') || 'ru');

  // Переключение языка с сохранением в localStorage
  const changeLanguage = (newLang) => {
    setLang(newLang);
    localStorage.setItem('app_lang', newLang);
  };

  // Функция перевода g(keyPath, fallback, params)
  const g = (keyPath, fallback = '', params = null) => {
    if (!keyPath) return fallback;

    const keys = keyPath.split('.');
    let result = translations[lang];

    for (const k of keys) {
      if (result && typeof result === 'object' && k in result) {
        result = result[k];
      } else {
        result = undefined;
        break;
      }
    }

    let text = typeof result === 'string' ? result : fallback;

    // Вставка динамических параметров {param}
    if (params && typeof params === 'object') {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(new RegExp(`{${k}}`, 'g'), String(v));
      });
    }

    return text;
  };

  return (
    <LanguageContext.Provider value={{ lang, changeLanguage, g }}>
      {children}
    </LanguageContext.Provider>
  );
}

// Хук с проверкой на наличие Provider
export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};