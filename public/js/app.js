document.addEventListener('DOMContentLoaded', async () => {
  // Initialize i18n (don't block search if this fails)
  try {
    await I18n.init();
  } catch (e) {
    console.error('[App] i18n init failed:', e);
  }

  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');

  // Search on button click
  searchBtn.addEventListener('click', () => {
    SearchUI.search(searchInput.value);
  });

  // Search on Enter key
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      SearchUI.search(searchInput.value);
    }
  });

  // Debounced live search (after 500ms of inactivity)
  let debounceTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (searchInput.value.trim().length >= 3) {
        SearchUI.search(searchInput.value);
      }
    }, 500);
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
