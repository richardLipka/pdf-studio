import React, { createContext, useContext, useState, useEffect } from 'react';
import { Language, TranslationSchema } from '../types/i18n';
import { cs } from './cs';
import { en } from './en';

interface I18nContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: TranslationSchema;
}

const translations: Record<Language, TranslationSchema> = {
  cs,
  en,
};

const I18nContext = createContext<I18nContextType | null>(null);

const STORAGE_KEY = 'pdf_studio_lang_v1';

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'cs' || saved === 'en') return saved;
      // Auto-detect browser language
      const navLang = navigator.language.toLowerCase();
      if (navLang.startsWith('cs') || navLang.startsWith('sk')) return 'cs';
      return 'en';
    } catch {
      return 'cs';
    }
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
      document.documentElement.lang = lang;
    } catch (e) {
      console.warn('Failed to save language to localStorage', e);
    }
  };

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = {
    language,
    setLanguage,
    t: translations[language],
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nContextType => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
};
