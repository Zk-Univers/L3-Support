const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = 'llama-3.1-8b-instant';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Cache AI answers
const answerCache = new Map();

async function generateAnswer(query, documentSections, targetLang = 'en') {
  if (!GROQ_API_KEY) return null;

  const cacheKey = `${query}:${targetLang}`;
  if (answerCache.has(cacheKey)) return answerCache.get(cacheKey);

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
            content: `You are an L3 technical support assistant for EGC microgrid systems. Answer questions based ONLY on the provided document context. Be concise (2-4 sentences max). If the documents don't contain enough info, say so briefly. ${langInstruction[targetLang] || langInstruction.en}`,
          },
          {
            role: 'user',
            content: `Documents:\n${context}\n\nQuestion: ${query}`,
          },
        ],
        max_tokens: 300,
        temperature: 0.3,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      console.error('[AI] Groq error:', err.error?.message || res.status);
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
