const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = 'llama-3.1-8b-instant';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Cache AI answers
const answerCache = new Map();

// Extract the most relevant portion of content around query terms
function extractRelevantChunks(content, query, maxChars = 3000) {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  const lower = content.toLowerCase();
  const chunks = [];
  const chunkSize = 800;

  // Find positions of all term matches
  const positions = [];
  for (const term of terms) {
    let pos = 0;
    while ((pos = lower.indexOf(term, pos)) !== -1) {
      positions.push(pos);
      pos += term.length;
    }
  }

  if (positions.length === 0) {
    // No matches, take the beginning
    return content.substring(0, maxChars);
  }

  // Sort and deduplicate positions, extract chunks around each
  const seen = new Set();
  positions.sort((a, b) => a - b);

  for (const pos of positions) {
    const chunkStart = Math.max(0, pos - 200);
    const chunkKey = Math.floor(chunkStart / chunkSize);
    if (seen.has(chunkKey)) continue;
    seen.add(chunkKey);

    const start = Math.max(0, pos - 200);
    const end = Math.min(content.length, pos + chunkSize);
    chunks.push(content.substring(start, end));

    if (chunks.join('').length >= maxChars) break;
  }

  return chunks.join('\n...\n').substring(0, maxChars);
}

async function generateAnswer(query, documentSections, targetLang = 'en') {
  if (!GROQ_API_KEY) return null;

  const cacheKey = `${query}:${targetLang}`;
  if (answerCache.has(cacheKey)) return answerCache.get(cacheKey);

  // Extract relevant portions from full document content
  const context = documentSections
    .slice(0, 2)
    .map((doc) => {
      const content = doc.fullContent || doc.summary.replace(/<\/?mark>/g, '');
      const relevant = extractRelevantChunks(content, query, 3000);
      return `[Document: ${doc.name}]\n${relevant}`;
    })
    .join('\n\n---\n\n');

  if (!context.trim()) return null;

  const langInstruction = {
    en: 'Answer in English.',
    cn: 'Answer in Chinese (简体中文).',
    jp: 'Answer in Japanese (日本語).',
  };

  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: 'system',
            content: `You are an L3 technical support assistant for EGC microgrid systems. You have access to the full content of support documents. Answer the user's question based ONLY on the provided documents.

Rules:
- Be helpful and specific - include relevant details, steps, and values from the documents.
- Use **bold** for important terms, values, and key concepts.
- When listing multiple items, conditions, or comparisons, use a markdown table (| Header | Header | format).
- Use numbered lists for step-by-step procedures.
- Use bullet points for non-sequential lists.
- Keep answers concise but complete (3-6 sentences, or a table + brief explanation).
- Always mention which document the information comes from.
${langInstruction[targetLang] || langInstruction.en}`,
          },
          {
            role: 'user',
            content: `Documents:\n${context}\n\nQuestion: ${query}`,
          },
        ],
        max_tokens: 500,
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      const errMsg = err.error?.message || '';
      // Retry once after rate limit
      if (res.status === 429 && errMsg.includes('try again in')) {
        const waitMatch = errMsg.match(/try again in ([\d.]+)s/);
        const waitSec = waitMatch ? Math.ceil(parseFloat(waitMatch[1])) + 1 : 10;
        console.log(`[AI] Rate limited, retrying in ${waitSec}s...`);
        await new Promise((r) => setTimeout(r, waitSec * 1000));
        const retryRes = await fetch(GROQ_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
          body: JSON.stringify({
            model: GROQ_MODEL,
            messages: [
              { role: 'system', content: `You are an L3 technical support assistant for EGC microgrid systems. Answer based ONLY on the provided documents. Be specific. ${langInstruction[targetLang] || langInstruction.en}` },
              { role: 'user', content: `Documents:\n${context}\n\nQuestion: ${query}` },
            ],
            max_tokens: 500,
            temperature: 0.3,
          }),
        });
        if (retryRes.ok) {
          const retryData = await retryRes.json();
          const retryAnswer = retryData.choices?.[0]?.message?.content;
          if (retryAnswer) answerCache.set(cacheKey, retryAnswer);
          return retryAnswer || null;
        }
      }
      console.error('[AI] Groq error:', errMsg);
      return null;
    }

    const data = await res.json();
    const answer = data.choices?.[0]?.message?.content;

    if (answer) {
      answerCache.set(cacheKey, answer);
      if (answerCache.size > 200) {
        const firstKey = answerCache.keys().next().value;
        answerCache.delete(firstKey);
      }
    }

    return answer || null;
  } catch (e) {
    console.error('[AI] Request failed:', e.message);
    return null;
  }
}

module.exports = { generateAnswer };
