const I18n = (() => {
  let currentLang = localStorage.getItem('kb-lang') || 'en';
  let strings = {};

  async function loadStrings(lang) {
    try {
      const res = await fetch(`/api/locales/${lang}`);
      strings = await res.json();
    } catch (e) {
      console.error('Failed to load locale:', e);
    }
  }

  function applyStrings() {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (strings[key]) el.textContent = strings[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (strings[key]) el.placeholder = strings[key];
    });
    document.title = strings.title || 'L3 Support Knowledge Base';
  }

  function updateButtons() {
    document.querySelectorAll('.lang-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.lang === currentLang);
    });
  }

  async function setLang(lang) {
    currentLang = lang;
    localStorage.setItem('kb-lang', lang);
    await loadStrings(lang);
    applyStrings();
    updateButtons();
  }

  function getLang() {
    return currentLang;
  }

  function t(key) {
    return strings[key] || key;
  }

  // Initialize
  async function init() {
    await loadStrings(currentLang);
    applyStrings();
    updateButtons();

    document.querySelectorAll('.lang-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        setLang(btn.dataset.lang);
        // Re-run current search with new language if there's a query
        if (typeof SearchUI !== 'undefined' && SearchUI.getCurrentQuery()) {
          SearchUI.search(SearchUI.getCurrentQuery());
        }
      });
    });
  }

  return { init, setLang, getLang, t };
})();
