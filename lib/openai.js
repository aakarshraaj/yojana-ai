const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function generateEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });

  return response.data[0].embedding;
}

async function generateChatResponse(
  question,
  context,
  memoryContext = "No saved profile yet",
  nextQuestion = null
) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: `
You are Yojana AI - an intelligent civic assistant helping Indian citizens discover relevant government schemes.

Rules:
- Use only the provided scheme context and user memory.
- Do not invent schemes.
- Prioritize top-ranked schemes (higher Final Rank Score).
- Include each scheme's Eligibility Probability (%) in recommendations.
- Recommend 2-4 most relevant schemes.
- For each recommendation, explain:
  - eligibility fit
  - why it matches the user profile
  - key benefit
- Include application readiness details when available:
  - documents required
  - where/how to apply (online/offline)
  - contact/helpline
- If NEXT QUESTION is provided, ask exactly that one follow-up question at the end.
- Keep output practical, concise, and structured with bullets.
        `,
      },
      {
        role: "user",
        content: `
USER QUESTION:
${question}

SAVED USER PROFILE MEMORY:
${memoryContext}

NEXT QUESTION:
${nextQuestion || "None"}

RANKED SCHEME CONTEXT:
${context}

Provide a clear recommendation.
        `,
      },
    ],
  });

  return completion.choices[0].message.content;
}

module.exports = {
  generateEmbedding,
  generateChatResponse,
};
