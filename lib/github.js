const mammoth = require('mammoth');
const XLSX = require('xlsx');

const REPO_OWNER = 'Zk-Univers';
const REPO_NAME = 'L3-Support';
const BRANCH = 'main';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';

const headers = {
  'Accept': 'application/vnd.github.v3+json',
  'User-Agent': 'L3-Support-KB',
};
if (GITHUB_TOKEN) {
  headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
}

const TEXT_EXTENSIONS = ['.md', '.txt', '.log', '.json', '.csv', '.yml', '.yaml', '.xml', '.html', '.rst'];
const BINARY_EXTENSIONS = ['.docx', '.xlsx', '.xls', '.pdf'];
const ALL_SUPPORTED = [...TEXT_EXTENSIONS, ...BINARY_EXTENSIONS];

let cachedFiles = [];
let lastTreeSha = null;

async function fetchRepoTree() {
  const res = await fetch(
    `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${BRANCH}?recursive=1`,
    { headers }
  );
  if (!res.ok) {
    console.error(`GitHub tree API error: ${res.status} ${res.statusText}`);
    return null;
  }
  const data = await res.json();
  return data;
}

async function fetchFileRaw(path, sha) {
  // Encode path segments individually (spaces become %20 per segment)
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const contentsUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${encodedPath}?ref=${BRANCH}`;

  // Get file metadata (always works, even for large files)
  const res = await fetch(contentsUrl, { headers });
  if (!res.ok) return null;

  const data = await res.json();

  // Small files: content is inline as base64
  if (data.encoding === 'base64' && data.content) {
    return Buffer.from(data.content, 'base64');
  }

  // Large files: use download_url (direct raw download, no API limits)
  if (data.download_url) {
    console.log(`[GitHub]   Using download_url for large file: ${path}`);
    const rawRes = await fetch(data.download_url);
    if (rawRes.ok) {
      const arrayBuffer = await rawRes.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
  }

  return null;
}

async function extractTextFromDocx(buffer) {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (e) {
    console.error('[Parser] DOCX extraction failed:', e.message);
    return null;
  }
}

async function extractTextFromXlsx(buffer) {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const texts = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      if (csv.trim()) {
        texts.push(`[Sheet: ${sheetName}]\n${csv}`);
      }
    }
    return texts.join('\n\n');
  } catch (e) {
    console.error('[Parser] XLSX extraction failed:', e.message);
    return null;
  }
}

async function extractTextFromPdf(buffer) {
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return data.text;
  } catch (e) {
    console.error('[Parser] PDF extraction failed:', e.message);
    return null;
  }
}

function getExtension(path) {
  return path.substring(path.lastIndexOf('.')).toLowerCase();
}

function isSupported(path) {
  return ALL_SUPPORTED.includes(getExtension(path));
}

async function fetchAndParseFile(filePath, sha) {
  const ext = getExtension(filePath);
  const buffer = await fetchFileRaw(filePath, sha);
  if (!buffer) return null;

  if (TEXT_EXTENSIONS.includes(ext)) {
    return buffer.toString('utf-8');
  }

  if (ext === '.docx') {
    return await extractTextFromDocx(buffer);
  }

  if (ext === '.xlsx' || ext === '.xls') {
    return await extractTextFromXlsx(buffer);
  }

  if (ext === '.pdf') {
    return await extractTextFromPdf(buffer);
  }

  return null;
}

async function refreshContent(force = false) {
  console.log('[GitHub] Fetching repository tree...');
  const tree = await fetchRepoTree();
  if (!tree) {
    console.error('[GitHub] Failed to fetch tree');
    return cachedFiles;
  }

  if (!force && tree.sha === lastTreeSha) {
    console.log('[GitHub] No changes detected');
    return cachedFiles;
  }

  const files = tree.tree.filter(
    (item) => item.type === 'blob' && isSupported(item.path)
  );

  console.log(`[GitHub] Found ${files.length} document(s), fetching and parsing...`);

  const results = [];
  // Fetch in batches of 3 (binary parsing is heavier)
  for (let i = 0; i < files.length; i += 3) {
    const batch = files.slice(i, i + 3);
    const contents = await Promise.all(
      batch.map(async (file) => {
        console.log(`[GitHub]   Parsing: ${file.path}`);
        const content = await fetchAndParseFile(file.path, file.sha);
        if (content) {
          return {
            id: file.path,
            path: file.path,
            name: file.path.split('/').pop(),
            content,
            sha: file.sha,
            githubUrl: `https://github.com/${REPO_OWNER}/${REPO_NAME}/blob/${BRANCH}/${file.path}`,
          };
        }
        console.warn(`[GitHub]   Skipped (no content): ${file.path}`);
        return null;
      })
    );
    results.push(...contents.filter(Boolean));
  }

  lastTreeSha = tree.sha;
  cachedFiles = results;
  console.log(`[GitHub] Indexed ${results.length} file(s)`);
  return results;
}

function getCachedFiles() {
  return cachedFiles;
}

module.exports = { refreshContent, getCachedFiles };
