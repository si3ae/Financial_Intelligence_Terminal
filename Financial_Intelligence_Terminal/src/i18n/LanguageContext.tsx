import React, { createContext, useContext, useState, useCallback } from 'react';
import { type Locale, type Translation, translations } from './translations';

interface LanguageContextType {
  locale: Locale;
  t: Translation;
  setLocale: (locale: Locale) => void;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>('en');
  const [transitioning, setTransitioning] = useState(false);

  const setLocale = useCallback((newLocale: Locale) => {
    setTransitioning(true);
    setTimeout(() => {
      setLocaleState(newLocale);
      setTransitioning(false);
    }, 150);
  }, []);

  return (
    <LanguageContext.Provider value={{ locale, t: translations[locale], setLocale }}>
      <div className={transitioning ? 'opacity-0 transition-opacity duration-150' : 'opacity-100 transition-opacity duration-300'}>
        {children}
      </div>
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within LanguageProvider');
  return context;
};
