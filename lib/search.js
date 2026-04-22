const indexer = require('./indexer');
const { getCachedFiles } = require('./github');

// CJK regex for sentence splitting
const CJK_REGEX = /[\u2E80-\u9FFF\uF900-\uFAFF\u3040-\u309F\u30A0-\u30FF]/;

// Clean content: strip YAML frontmatter, CSV noise, metadata lines
function cleanContent(text) {
  let cleaned = text;
  // Remove YAML frontmatter (---...---)
  cleaned = cleaned.replace(/^---[\s\S]*?---\s*/m, '');
  // Remove lines that are mostly commas/pipes (CSV artifacts)
  cleaned = cleaned.split('\n').filter((line) => {
    const commas = (line.match(/,/g) || []).length;
    const total = line.trim().length;
    if (total === 0) return false;
    // Skip lines that are >50% commas or pipes
    return commas / total < 0.5;
  }).join('\n');
  // Remove repeated commas
  cleaned = cleaned.replace(/,{2,}/g, ' ');
  // Remove markdown table separators
  cleaned = cleaned.replace(/\|[-:]+\|/g, '');
  // Collapse whitespace
  cleaned = cleaned.replace(/\s{3,}/g, ' ');
  return cleaned.trim();
}

// Split content into logical sections based on headings
function splitIntoSections(content) {
  const lines = content.split('\n');
  const sections = [];
  let currentHeading = '';
  let currentBody = [];

  const headingPattern = /^(?:#{1,4}\s+.+|[\d]+[\.\)]\s*.+|[A-Z][A-Za-z\s]{3,50}:?\s*$|\[Sheet:\s*.+\])/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && headingPattern.test(trimmed)) {
      if (currentBody.length > 0 || currentHeading) {
        sections.push({ heading: currentHeading, body: currentBody.join('\n').trim() });
      }
      currentHeading = trimmed.replace(/^#+\s*/, '');
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }
  if (currentBody.length > 0 || currentHeading) {
    sections.push({ heading: currentHeading, body: currentBody.join('\n').trim() });
  }
  if (sections.length === 0) {
    sections.push({ heading: '', body: content.trim() });
  }
  return sections;
}

// Score a section against query terms
function scoreSection(section, terms) {
  const text = (section.heading + ' ' + section.body).toLowerCase();
  let score = 0;
  for (const term of terms) {
    const t = term.toLowerCase();
    let pos = 0;
    while ((pos = text.indexOf(t, pos)) !== -1) {
      score += 1;
      pos += t.length;
    }
    if (section.heading.toLowerCase().includes(t)) score += 5;
  }
  return score;
}

// Split text into sentences (handles EN, CN, JP)
function splitSentences(text) {
  const normalized = text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();

  // Split on sentence-ending punctuation (EN + CJK)
  const parts = normalized.split(/(?<=[.!?。！？；\n])\s*/);

  // Also split on common delimiters like - bullets, | pipes, numbered items
  const sentences = [];
  for (const part of parts) {
    const sub = part.split(/(?:^|\s)[-•]\s|(?:^|\s)\d+[.\)]\s/).filter(Boolean);
    sentences.push(...sub);
  }

  return sentences.map((s) => s.trim()).filter((s) => s.length > 5);
}

// Build a concise, keyword-focused summary
function buildKeywordSummary(body, terms, maxLen = 250) {
  const sentences = splitSentences(body);
  if (sentences.length === 0) return '';

  // Score each sentence by how many query terms it contains
  const scored = sentences.map((s) => {
    const lower = s.toLowerCase();
    let hits = 0;
    for (const term of terms) {
      if (lower.includes(term.toLowerCase())) hits++;
    }
    return { text: s, hits };
  });

  // Sort: sentences with most term hits first, then by original order for ties
  const withHits = scored.filter((s) => s.hits > 0);
  const topSentences = withHits.length > 0 ? withHits : scored.slice(0, 2);

  // Take the top matching sentences up to maxLen
  let summary = '';
  for (const s of topSentences) {
    const candidate = s.text.length > 150 ? s.text.substring(0, 150).trim() + '...' : s.text;
    if (summary.length + candidate.length > maxLen) break;
    summary += (summary ? ' | ' : '') + candidate;
  }

  if (!summary) {
    summary = body.substring(0, maxLen).trim();
    if (summary.length < body.length) summary += '...';
  }

  return summary;
}

// Highlight query terms in text
function highlightTerms(text, terms) {
  let result = text;
  for (const term of terms) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // For CJK single chars, match exactly; for multi-char, match the term
    const regex = new RegExp(`(${escaped})`, 'gi');
    result = result.replace(regex, '<mark>$1</mark>');
  }
  return result;
}

// Build a short context window around the first match
function buildExcerpt(text, terms, maxLen = 250) {
  const lower = text.toLowerCase();
  let bestPos = -1;
  for (const term of terms) {
    const pos = lower.indexOf(term.toLowerCase());
    if (pos !== -1 && (bestPos === -1 || pos < bestPos)) bestPos = pos;
  }

  let start, end;
  if (bestPos === -1) {
    start = 0;
    end = Math.min(maxLen, text.length);
  } else {
    start = Math.max(0, bestPos - 60);
    end = Math.min(text.length, start + maxLen);
    // Snap to word boundary
    if (start > 0) {
      const spaceIdx = text.indexOf(' ', start);
      if (spaceIdx > 0 && spaceIdx < start + 20) start = spaceIdx + 1;
    }
  }

  let excerpt = text.substring(start, end).trim();
  if (start > 0) excerpt = '...' + excerpt;
  if (end < text.length) excerpt += '...';

  return excerpt;
}

function extractSectionInfo(content, queryTerms) {
  const sections = splitIntoSections(content);
  const terms = queryTerms.filter((t) => t.length > 1);

  // Find best matching section
  let bestSection = sections[0];
  let bestScore = -1;
  for (const section of sections) {
    const score = scoreSection(section, terms);
    if (score > bestScore) {
      bestScore = score;
      bestSection = section;
    }
  }

  const sectionHeading = bestSection.heading || '';
  const sectionText = bestSection.body;
  const cleanedText = cleanContent(sectionText);

  // Build keyword-focused summary (concise, shows relevant sentences)
  const summary = buildKeywordSummary(cleanedText, terms);
  const highlightedSummary = highlightTerms(summary, terms);

  // Build excerpt (raw context window around first match in cleaned text)
  const excerpt = buildExcerpt(cleanedText, terms);
  const highlightedExcerpt = highlightTerms(excerpt, terms);

  return {
    sectionHeading,
    excerpt: highlightedExcerpt,
    summary: highlightedSummary,
  };
}

function performSearch(query) {
  const results = indexer.search(query, 10);
  const queryTerms = query.split(/\s+/).filter((t) => t.length > 1);

  const primary = results.slice(0, 10).map((r) => {
    const info = extractSectionInfo(r.content, queryTerms);
    return {
      path: r.path,
      name: r.name,
      sectionHeading: info.sectionHeading,
      summary: info.summary,
      excerpt: info.excerpt,
      fullContent: r.content,
      score: r.score,
      githubUrl: r.githubUrl,
    };
  }).map((r) => {
    // If summary is blank, fall back to excerpt
    const cleaned = r.summary.replace(/<\/?mark>/g, '').replace(/\.\.\./g, '').trim();
    if (cleaned.length === 0) r.summary = r.excerpt;
    return r;
  }).filter((r) => {
    const cleaned = r.summary.replace(/<\/?mark>/g, '').replace(/\.\.\./g, '').trim();
    return cleaned.length > 0;
  }).slice(0, 5);

  const related = results.slice(5, 10).map((r) => ({
    path: r.path,
    name: r.name,
    githubUrl: r.githubUrl,
    score: r.score,
  }));

  if (primary.length > 0 && related.length === 0) {
    const topFolder = primary[0].path.includes('/')
      ? primary[0].path.substring(0, primary[0].path.lastIndexOf('/'))
      : '';
    const allFiles = getCachedFiles();
    const primaryPaths = new Set(primary.map((p) => p.path));
    const folderRelated = allFiles
      .filter((f) => !primaryPaths.has(f.path) && f.path.startsWith(topFolder) && topFolder)
      .slice(0, 3)
      .map((f) => ({ path: f.path, name: f.name, githubUrl: f.githubUrl }));
    related.push(...folderRelated);
  }

  return { results: primary, relatedFiles: related };
}

module.exports = { performSearch };
