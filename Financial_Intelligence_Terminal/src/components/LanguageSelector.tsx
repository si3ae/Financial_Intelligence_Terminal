import { useLanguage } from '@/i18n/LanguageContext';
import { type Locale, localeFlags, localeNames } from '@/i18n/translations';

const locales: Locale[] = ['ko', 'en', 'zh', 'ja', 'gb', 'de', 'fr', 'it'];

const LanguageSelector = () => {
  const { locale, setLocale } = useLanguage();

  return (
    <div className="flex items-center gap-1">
      {locales.map((loc) => (
        <button
          key={loc}
          onClick={() => setLocale(loc)}
          title={localeNames[loc]}
          className={`
            px-2 py-1.5 rounded-lg text-lg transition-all duration-200 cursor-pointer
            ${locale === loc
              ? 'bg-card shadow-sm scale-110'
              : 'hover:bg-card/60 opacity-60 hover:opacity-100'}
          `}
        >
          {localeFlags[loc]}
        </button>
      ))}
    </div>
  );
};

export default LanguageSelector;
