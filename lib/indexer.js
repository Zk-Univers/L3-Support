const MiniSearch = require('minisearch');

let miniSearch = null;

// CJK Unicode ranges
const CJK_REGEX = /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF\uFF00-\uFFEF]/;

function tokenize(text) {
  const lower = text.toLowerCase();
  const tokens = [];

  // First split on whitespace and punctuation to get word chunks
  const chunks = lower.split(/[\s\-_./\\,;:!?()[\]{}<>"'`~@#$%^&*+=|]+/).filter((t) => t.length > 0);

  for (const chunk of chunks) {
    if (!CJK_REGEX.test(chunk)) {
      // Latin/non-CJK text: use as-is
      if (chunk.length > 0) tokens.push(chunk);
    } else {
      // Mixed or CJK text: extract CJK bigrams + individual characters + Latin segments
      let latinBuf = '';
      const chars = [...chunk]; // Spread to handle multi-byte properly

      for (let i = 0; i < chars.length; i++) {
        if (CJK_REGEX.test(chars[i])) {
          // Flush any Latin buffer
          if (latinBuf.length > 0) {
            tokens.push(latinBuf);
            latinBuf = '';
          }
          // Add individual CJK character
          tokens.push(chars[i]);
          // Add bigram (2-char pair) for better phrase matching
          if (i + 1 < chars.length && CJK_REGEX.test(chars[i + 1])) {
            tokens.push(chars[i] + chars[i + 1]);
          }
        } else {
          latinBuf += chars[i];
        }
      }
      if (latinBuf.length > 0) tokens.push(latinBuf);
    }
  }

  return tokens;
}

function buildIndex(files) {
  miniSearch = new MiniSearch({
    fields: ['name', 'content'],
    storeFields: ['name', 'path', 'content', 'githubUrl'],
    searchOptions: {
      boost: { name: 3 },
      fuzzy: 0.2,
      prefix: true,
    },
    tokenize,
  });

  miniSearch.addAll(files);
  console.log(`[Indexer] Built index with ${files.length} document(s)`);
}

function search(query, limit = 10) {
  if (!miniSearch) return [];
  return miniSearch.search(query, { limit, tokenize });
}

function autoSuggest(query) {
  if (!miniSearch) return [];
  return miniSearch.autoSuggest(query, { limit: 5, tokenize });
}

module.exports = { buildIndex, search, autoSuggest };
