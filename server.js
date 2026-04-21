require('dotenv').config();
const express = require('express');
const path = require('path');
const { refreshContent, getCachedFiles } = require('./lib/github');
const { buildIndex } = require('./lib/indexer');
const { performSearch } = require('./lib/search');
const { getUIStrings, translateText } = require('./lib/translator');

const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

let lastRefresh = null;

// Parse JSON body for webhook
app.use('/api/webhook', express.json());

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API: Search
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  const lang = req.query.lang || 'en';

  if (!query || query.trim().length === 0) {
    return res.json({ results: [], relatedFiles: [] });
  }

  try {
    const searchResults = performSearch(query.trim());
    res.json(searchResults);
  } catch (err) {
    console.error('[Search] Error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// API: Get UI locale strings
app.get('/api/locales/:lang', (req, res) => {
  const lang = req.params.lang;
  const strings = getUIStrings(lang);
  res.json(strings);
});

// API: Translate a piece of text on demand
app.get('/api/translate', async (req, res) => {
  const text = req.query.text;
  const lang = req.query.lang;

  if (!text || !lang) {
    return res.status(400).json({ error: 'Missing text or lang parameter' });
  }

  try {
    const translated = await translateText(text, lang);
    res.json({ original: text, translated, lang });
  } catch (err) {
    res.status(500).json({ error: 'Translation failed' });
  }
});

// API: Index stats
app.get('/api/stats', (req, res) => {
  const files = getCachedFiles();
  res.json({
    fileCount: files.length,
    lastRefresh: lastRefresh ? lastRefresh.toISOString() : null,
    files: files.map((f) => ({ path: f.path, name: f.name })),
  });
});

// API: Manual refresh (force re-download and re-index)
app.post('/api/refresh', async (req, res) => {
  const files = await refreshContent(true);
  if (files && files.length > 0) {
    buildIndex(files);
  }
  lastRefresh = new Date();
  res.json({ success: true, fileCount: getCachedFiles().length });
});

// GitHub Webhook: auto-update when files are pushed
app.post('/api/webhook', (req, res) => {
  // Verify signature if secret is configured
  if (WEBHOOK_SECRET) {
    const sig = req.headers['x-hub-signature-256'] || '';
    const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
    hmac.update(JSON.stringify(req.body));
    const expected = 'sha256=' + hmac.digest('hex');
    if (sig !== expected) {
      console.warn('[Webhook] Invalid signature, ignoring');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  const event = req.headers['x-github-event'];
  if (event === 'push') {
    const ref = req.body.ref || '';
    console.log(`[Webhook] Push event received on ${ref}`);
    if (ref === 'refs/heads/main') {
      // Refresh after a short delay to let GitHub settle
      setTimeout(async () => {
        console.log('[Webhook] Refreshing index...');
        await initializeIndex();
        console.log(`[Webhook] Index refreshed: ${getCachedFiles().length} files`);
      }, 3000);
    }
  }

  res.json({ received: true });
});

// Initialize: fetch content and build index
async function initializeIndex() {
  const files = await refreshContent();
  if (files && files.length > 0) {
    buildIndex(files);
  }
  lastRefresh = new Date();
}

// Start server
async function start() {
  console.log('[Server] Initializing knowledge base...');
  await initializeIndex();

  // Periodic refresh
  setInterval(initializeIndex, REFRESH_INTERVAL);

  app.listen(PORT, () => {
    console.log(`[Server] L3 Support Knowledge Base running at http://localhost:${PORT}`);
  });
}

start();
