const path = require('path');
const fs = require('fs');

// Cache for translations
const translationCache = new Map();

// Load locale files
const localesDir = path.join(__dirname, '..', 'locales');
const locales = {};

function loadLocales() {
  for (const lang of ['en', 'cn', 'jp']) {
    const filePath = path.join(localesDir, `${lang}.json`);
    if (fs.existsSync(filePath)) {
      locales[lang] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
  }
}

function getUIStrings(lang) {
  if (!locales[lang]) loadLocales();
  return locales[lang] || locales['en'] || {};
}

let translate = null;

async function loadTranslator() {
  try {
    const mod = await import('google-translate-api-x');
    translate = mod.default || mod;
    console.log('[Translator] Loaded successfully, type:', typeof translate);
  } catch (e) {
    console.error('[Translator] Failed to load:', e.message, e.stack);
  }
}

const LANG_MAP = {
  en: 'en',
  cn: 'zh-CN',
  jp: 'ja',
};

async function translateText(text, targetLang) {
  if (!text || !targetLang) return text;

  const cacheKey = `${targetLang}:${text.substring(0, 100)}`;
  if (translationCache.has(cacheKey)) {
    const cached = translationCache.get(cacheKey);
    // Don't serve cache if it's identical to input (likely a failed/skipped translation)
    if (cached !== text) return cached;
    translationCache.delete(cacheKey);
  }

  if (!translate) await loadTranslator();
  if (!translate) return text;

  try {
    // Strip HTML marks before translating, restore after
    const marks = [];
    const cleaned = text.replace(/<mark>(.*?)<\/mark>/g, (_, m) => {
      marks.push(m);
      return `__MARK${marks.length - 1}__`;
    });

    const targetCode = LANG_MAP[targetLang] || 'en';
    console.log(`[Translator] Translating to ${targetCode}: "${cleaned.substring(0, 50)}..."`);
    const result = await translate(cleaned, { to: targetCode });
    console.log(`[Translator] Result: "${(result.text || '').substring(0, 50)}..."`);
    let translated = result.text || text;

    // Restore marks
    translated = translated.replace(/__MARK(\d+)__/g, (_, i) => `<mark>${marks[parseInt(i)]}</mark>`);

    // Only cache if translation actually changed the text
    if (translated !== cleaned) {
      translationCache.set(cacheKey, translated);
    }
    return translated;
  } catch (e) {
    console.error('[Translator] Translation failed:', e.message);
    return text;
  }
}

// Limit cache size
setInterval(() => {
  if (translationCache.size > 1000) {
    const keys = [...translationCache.keys()];
    for (let i = 0; i < 500; i++) {
      translationCache.delete(keys[i]);
    }
  }
}, 60000);

loadLocales();

module.exports = { getUIStrings, translateText };
