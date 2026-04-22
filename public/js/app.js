document.addEventListener('DOMContentLoaded', async () => {
  // Initialize i18n (don't block search if this fails)
  try {
    await I18n.init();
  } catch (e) {
    console.error('[App] i18n init failed:', e);
  }

  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');

  // Search on button click (with AI if toggle is on)
  searchBtn.addEventListener('click', () => {
    SearchUI.search(searchInput.value, SearchUI.isAIEnabled());
  });

  // Search on Enter key (with AI if toggle is on)
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      SearchUI.search(searchInput.value, SearchUI.isAIEnabled());
    }
  });

  // Debounced live search (NO AI - only on explicit search)
  let debounceTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (searchInput.value.trim().length >= 3) {
        SearchUI.search(searchInput.value, false);
      }
    }, 500);
  });

  // Restore AI toggle state
  const aiToggle = document.getElementById('aiToggle');
  const savedAI = localStorage.getItem('kb-ai-toggle');
  if (savedAI === 'true') aiToggle.checked = true;
  aiToggle.addEventListener('change', () => {
    localStorage.setItem('kb-ai-toggle', aiToggle.checked);
  });

  // Load stats
  try {
    const res = await fetch('/api/stats');
    const stats = await res.json();
    const statsEl = document.getElementById('statsInfo');
    if (stats.fileCount > 0) {
      statsEl.textContent = `${stats.fileCount} ${I18n.t('indexedFiles')}`;
    }
  } catch (e) {
    // Stats are non-critical
  }

  // Dark mode toggle
  const themeToggle = document.getElementById('themeToggle');
  const savedTheme = localStorage.getItem('kb-theme');
  if (savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  themeToggle.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (isDark) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('kb-theme', 'light');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('kb-theme', 'dark');
    }
  });

  // Focus search input
  searchInput.focus();
});
