const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

// Cache AI answers to avoid repeated calls
const answerCache = new Map();

async function generateAnswer(query, documentSections, targetLang = 'en') {
  if (!GEMINI_API_KEY) {
    return null;
  }

  const cacheKey = `${query}:${targetLang}`;
  if (answerCache.has(cacheKey)) return answerCache.get(cacheKey);

  // Build context from matched document sections
  const context = documentSections
    .slice(0, 3)
    .map((doc) => {
      const text = doc.summary.replace(/<\/?mark>/g, '');
      return `[${doc.name}]\n${text}`;
    })
    .join('\n\n');

  if (!context.trim()) return null;

  const langInstruction = {
    en: 'Answer in English.',
    cn: 'Answer in Chinese (简体中文).',
    jp: 'Answer in Japanese (日本語).',
  };

  const prompt = `You are an L3 technical support assistant for EGC microgrid systems. Based ONLY on the following document excerpts, answer the user's question concisely (2-4 sentences max). If the documents don't contain enough info, say so briefly. ${langInstruction[targetLang] || langInstruction.en}

Documents:
${context}

Question: ${query}

Answer:`;

  try {
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 300,
          temperature: 0.3,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      console.error('[AI] Gemini error:', err.error?.message || res.status);
      return null;
    }

    const data = await res.json();
    const answer = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (answer) {
      answerCache.set(cacheKey, answer);
      // Keep cache small
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
