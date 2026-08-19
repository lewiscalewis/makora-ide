import { describe, it, expect } from "vitest";
import { es } from "../i18n/locales/es";
import { en } from "../i18n/locales/en";
import { zh } from "../i18n/locales/zh";
import { de } from "../i18n/locales/de";
import { fr } from "../i18n/locales/fr";
import { it as itLocale } from "../i18n/locales/it";
import { pt } from "../i18n/locales/pt";
import type { TranslationSchema } from "../i18n/types";

const ALL_LOCALES: Record<string, TranslationSchema> = {
  es,
  en,
  zh,
  de,
  fr,
  it: itLocale,
  pt,
};

function getDeepKeys(obj: Record<string, any>, prefix = ""): string[] {
  let keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      keys = keys.concat(getDeepKeys(v, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys.sort();
}

describe("i18n Completeness and Key Parity Test", () => {
  const referenceKeys = getDeepKeys(es);

  it("should have at least 150 translation keys defined in the schema", () => {
    expect(referenceKeys.length).toBeGreaterThan(150);
  });

  for (const [lang, dict] of Object.entries(ALL_LOCALES)) {
    it(`locale '${lang}' should have 100% key parity with reference 'es'`, () => {
      const currentKeys = getDeepKeys(dict);
      const missingKeys = referenceKeys.filter((k) => !currentKeys.includes(k));
      const extraKeys = currentKeys.filter((k) => !referenceKeys.includes(k));

      expect(missingKeys, `Missing keys in locale '${lang}': ${missingKeys.join(", ")}`).toEqual([]);
      expect(extraKeys, `Unexpected extra keys in locale '${lang}': ${extraKeys.join(", ")}`).toEqual([]);
    });

    it(`locale '${lang}' should have no empty or whitespace-only translation values`, () => {
      function checkNonEmpty(subObj: Record<string, any>, path = "") {
        for (const [k, v] of Object.entries(subObj)) {
          const currentPath = path ? `${path}.${k}` : k;
          if (v && typeof v === "object") {
            checkNonEmpty(v, currentPath);
          } else {
            expect(typeof v, `Value at ${currentPath} should be string`).toBe("string");
            expect(v.trim().length, `Value at ${currentPath} in '${lang}' should not be empty`).toBeGreaterThan(0);
          }
        }
      }
      checkNonEmpty(dict);
    });
  }
});
