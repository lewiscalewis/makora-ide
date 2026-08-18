import { createContext, useContext, useState, type ReactNode } from "react";
import type { LanguageId, TranslationSchema } from "./types";
import { LANGUAGE_LIST } from "./types";
import { es } from "./locales/es";
import { en } from "./locales/en";
import { zh } from "./locales/zh";
import { de } from "./locales/de";
import { fr } from "./locales/fr";
import { it } from "./locales/it";
import { pt } from "./locales/pt";

const LOCALES: Record<LanguageId, TranslationSchema> = {
  es,
  en,
  zh,
  de,
  fr,
  it,
  pt,
};

interface I18nContextType {
  language: LanguageId;
  setLanguage: (lang: LanguageId) => void;
  t: TranslationSchema;
}

const I18nContext = createContext<I18nContextType>({
  language: "es",
  setLanguage: () => undefined,
  t: es,
});

const STORAGE_KEY = "makora.language";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LanguageId>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as LanguageId | null;
      if (saved && LOCALES[saved]) return saved;
      const navLang = navigator.language.slice(0, 2).toLowerCase();
      if (navLang in LOCALES) return navLang as LanguageId;
    } catch {
      // Fallback
    }
    return "es";
  });

  const setLanguage = (lang: LanguageId) => {
    if (LOCALES[lang]) {
      setLanguageState(lang);
      try {
        localStorage.setItem(STORAGE_KEY, lang);
      } catch {
        // Ignored
      }
    }
  };

  const currentTranslations = LOCALES[language] || es;

  return (
    <I18nContext.Provider value={{ language, setLanguage, t: currentTranslations }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

export { LANGUAGE_LIST };
export type { LanguageId, LanguageOption, TranslationSchema } from "./types";
