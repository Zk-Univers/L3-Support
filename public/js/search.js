const SearchUI = (() => {
  let currentQuery = '';

  function getCurrentQuery() {
    return currentQuery;
  }

  function showSection(id) {
    ['welcomeSection', 'loadingSection', 'resultsSection', 'relatedSection', 'noResultsSection'].forEach((s) => {
      document.getElementById(s).classList.add('hidden');
    });
    if (id) document.getElementById(id).classList.remove('hidden');
  }

  // Format AI answer: bold, tables, bullet points, numbered lists
  function formatAIAnswer(text) {
    let html = escapeHtml(text);

    // Bold: **text** → <strong>text</strong>
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Check if the answer has markdown table (lines with |)
    const lines = html.split('\n');
    const tableLines = lines.filter((l) => l.trim().startsWith('|') && l.trim().endsWith('|'));
    if (tableLines.length >= 2) {
      // Parse markdown table
      const parts = [];
      let inTable = false;
      let tableRows = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
          // Skip separator rows (|---|---|)
          if (/^\|[\s\-:]+\|$/.test(trimmed.replace(/\|/g, '|').replace(/[\s\-:]/g, ''))) {
            continue;
          }
          if (!inTable) inTable = true;
          const cells = trimmed.split('|').filter((c, i, a) => i > 0 && i < a.length - 1).map((c) => c.trim());
          tableRows.push(cells);
        } else {
          if (inTable) {
            parts.push(buildTable(tableRows));
            tableRows = [];
            inTable = false;
          }
          parts.push(trimmed);
        }
      }
      if (inTable) parts.push(buildTable(tableRows));
      html = parts.join('\n');
    }

    // Bullet points: lines starting with * or - or •
    html = html.replace(/^[\*\-•]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    // Numbered lists: lines starting with 1. 2. etc
    html = html.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');
    // Wrap consecutive <li> not already in <ul> into <ol>
    html = html.replace(/(?<!<\/ul>)(<li>.*?<\/li>\n?)+/g, (match) => {
      if (match.includes('<ul>')) return match;
      return '<ol>' + match + '</ol>';
    });

    // Paragraphs: double newlines
    html = html.replace(/\n\n+/g, '</p><p>');
    // Single newlines (not inside lists/tables)
    html = html.replace(/\n/g, '<br>');

    // Clean up empty tags
    html = html.replace(/<p><\/p>/g, '');
    html = '<p>' + html + '</p>';
    html = html.replace(/<p>(<(?:ul|ol|table))/g, '$1');
    html = html.replace(/(<\/(?:ul|ol|table)>)<\/p>/g, '$1');

    return html;
  }

  function buildTable(rows) {
    if (rows.length === 0) return '';
    let table = '<table class="ai-table"><thead><tr>';
    // First row is header
    rows[0].forEach((cell) => { table += `<th>${cell}</th>`; });
    table += '</tr></thead><tbody>';
    for (let i = 1; i < rows.length; i++) {
      table += '<tr>';
      rows[i].forEach((cell) => { table += `<td>${cell}</td>`; });
      table += '</tr>';
    }
    table += '</tbody></table>';
    return table;
  }

  // Detect if text contains CJK or non-Latin characters
  function hasForeignText(text) {
    return /[\u2E80-\u9FFF\uF900-\uFAFF\u3040-\u309F\u30A0-\u30FF]/.test(text);
  }

  // Determine translation target: if user lang is EN and text has CJK, translate to EN
  // If user lang is CN/JP, translate to that language
  function getTranslateTarget(text) {
    const lang = I18n.getLang();
    if (lang === 'en' && hasForeignText(text)) return 'en';
    if (lang === 'cn') return 'cn';
    if (lang === 'jp') return 'jp';
    if (hasForeignText(text)) return 'en';
    return null;
  }

  function getTranslateLangLabel(target) {
    if (target === 'en') return 'English';
    if (target === 'cn') return '中文';
    if (target === 'jp') return '日本語';
    return '';
  }

  function createResultCard(result) {
    const card = document.createElement('div');
    card.className = 'result-card';

    const sectionLabel = result.sectionHeading ? escapeHtml(result.sectionHeading) : '';
    const plainSummary = result.summary.replace(/<\/?mark>/g, '');
    const translateTarget = getTranslateTarget(plainSummary);
    const showTranslateBtn = translateTarget !== null;

    card.innerHTML = `
      <div class="result-card-header">
        <svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
        <h3>${escapeHtml(result.name)}</h3>
        <span class="result-path">${escapeHtml(result.path)}</span>
      </div>
      ${sectionLabel ? `<div class="result-section-heading">${sectionLabel}</div>` : ''}
      <div class="result-summary">
        <div class="summary-label">${I18n.t('summaryLabel')}</div>
        <div class="summary-text">${result.summary}</div>
      </div>
      <div class="translated-content hidden" data-translated></div>
      <div class="result-actions">
        <a href="${escapeHtml(result.githubUrl)}" target="_blank" rel="noopener" class="btn-link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          ${I18n.t('viewOnGithub')}
        </a>
        ${showTranslateBtn ? `
          <button class="btn-link btn-translate" data-target-lang="${translateTarget}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 19l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"/>
            </svg>
            ${I18n.t('translateTo')} ${getTranslateLangLabel(translateTarget)}
          </button>
        ` : ''}
      </div>
    `;

    // Bind translate button
    const translateBtn = card.querySelector('.btn-translate');
    if (translateBtn) {
      translateBtn.addEventListener('click', () => handleTranslate(card, translateBtn));
    }

    return card;
  }

  async function handleTranslate(card, btn) {
    const translatedDiv = card.querySelector('[data-translated]');
    const targetLang = btn.dataset.targetLang;

    // Toggle if already translated
    if (translatedDiv.dataset.loaded === 'true') {
      const isHidden = translatedDiv.classList.contains('hidden');
      translatedDiv.classList.toggle('hidden');
      btn.classList.toggle('active', isHidden);
      const langLabel = getTranslateLangLabel(targetLang);
      btn.innerHTML = isHidden
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 19l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"/></svg> ${I18n.t('showOriginal')}`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 19l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"/></svg> ${I18n.t('translateTo')} ${langLabel}`;
      return;
    }

    // Fetch translation
    const summaryText = card.querySelector('.summary-text').textContent;
    btn.disabled = true;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 19l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"/></svg> ${I18n.t('translating')}`;

    try {
      const res = await fetch(`/api/translate?text=${encodeURIComponent(summaryText)}&lang=${targetLang}`);
      const data = await res.json();

      translatedDiv.innerHTML = `
        <div class="summary-label">${I18n.t('translatedLabel')} (${getTranslateLangLabel(targetLang)})</div>
        <div class="summary-text">${escapeHtml(data.translated)}</div>
      `;
      translatedDiv.dataset.loaded = 'true';
      translatedDiv.classList.remove('hidden');
      btn.classList.add('active');
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 19l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"/></svg> ${I18n.t('showOriginal')}`;
    } catch (e) {
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 19l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"/></svg> ${I18n.t('translateFailed')}`;
    }
    btn.disabled = false;
  }

  function createRelatedChip(file) {
    const chip = document.createElement('a');
    chip.className = 'related-chip';
    chip.href = file.githubUrl;
    chip.target = '_blank';
    chip.rel = 'noopener';
    chip.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      ${escapeHtml(file.name)}
    `;
    return chip;
  }

  // Search only (no AI)
  async function search(query, withAI = false) {
    if (!query || query.trim().length === 0) {
      showSection('welcomeSection');
      return;
    }

    currentQuery = query;
    showSection('loadingSection');

    // Always hide AI box at start
    const aiBox = document.getElementById('aiAnswer');
    aiBox.classList.add('hidden');
    aiBox.innerHTML = '';

    try {
      const lang = I18n.getLang();
      const url = `/api/search?q=${encodeURIComponent(query)}&lang=${lang}`;
      const res = await fetch(url);
      if (!res.ok) {
        showSection('noResultsSection');
        return;
      }
      const data = await res.json();

      if (!data.results || data.results.length === 0) {
        showSection('noResultsSection');
        return;
      }

      // Render search results immediately
      const resultsList = document.getElementById('resultsList');
      resultsList.innerHTML = '';
      data.results.forEach((r) => {
        resultsList.appendChild(createResultCard(r));
      });

      const countEl = document.getElementById('resultCount');
      countEl.textContent = `${data.results.length} ${I18n.t('resultCount')}`;

      showSection('resultsSection');

      if (data.relatedFiles && data.relatedFiles.length > 0) {
        const relatedList = document.getElementById('relatedList');
        relatedList.innerHTML = '';
        data.relatedFiles.forEach((f) => {
          relatedList.appendChild(createRelatedChip(f));
        });
        document.getElementById('relatedSection').classList.remove('hidden');
      }

      // Fetch AI answer separately if toggle is on
      if (withAI) {
        fetchAIAnswer(query, lang, data.results);
      }
    } catch (e) {
      console.error('[Search] Error:', e);
      showSection('noResultsSection');
    }
  }

  // Fetch AI answer separately (non-blocking, after results are shown)
  async function fetchAIAnswer(query, lang, results) {
    const aiBox = document.getElementById('aiAnswer');
    // Show loading state
    aiBox.innerHTML = `
      <div class="ai-answer-label">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2a4 4 0 0 1 4 4v1a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2V6a4 4 0 0 1 4-4z"/>
          <path d="M9 18h6"/><path d="M10 22h4"/>
          <path d="M12 14v4"/>
        </svg>
        ${I18n.t('aiAnswerLabel')}
      </div>
      <div class="ai-answer-text"><span class="ai-loading">${I18n.t('aiLoading')}</span></div>
    `;
    aiBox.classList.remove('hidden');

    try {
      const res = await fetch(`/api/ai-answer?q=${encodeURIComponent(query)}&lang=${lang}`);
      const data = await res.json();

      if (data.answer) {
        const sources = (data.sources || results.slice(0, 3)).map((r) =>
          `<a href="${escapeHtml(r.githubUrl)}" target="_blank" rel="noopener" class="ai-source-link">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            ${escapeHtml(r.name)}
          </a>`
        ).join('');

        aiBox.innerHTML = `
          <div class="ai-answer-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2a4 4 0 0 1 4 4v1a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2V6a4 4 0 0 1 4-4z"/>
              <path d="M9 18h6"/><path d="M10 22h4"/>
              <path d="M12 14v4"/>
            </svg>
            ${I18n.t('aiAnswerLabel')}
          </div>
          <div class="ai-answer-text">${formatAIAnswer(data.answer)}</div>
          <div class="ai-sources">
            <span class="ai-sources-label">${I18n.t('sourcesLabel')}</span>
            ${sources}
          </div>
        `;
      } else {
        aiBox.classList.add('hidden');
        aiBox.innerHTML = '';
      }
    } catch (e) {
      aiBox.classList.add('hidden');
      aiBox.innerHTML = '';
    }
  }

  function isAIEnabled() {
    const toggle = document.getElementById('aiToggle');
    return toggle && toggle.checked;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  return { search, getCurrentQuery, isAIEnabled };
})();
