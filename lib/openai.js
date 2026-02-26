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

async function generateChatResponse(question, context) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content: `
You are Yojana AI — an intelligent civic assistant helping Indian citizens discover relevant government schemes.

Rules:
- Only use the provided scheme context.
- Do NOT invent schemes.
- Recommend 2–4 most relevant schemes.
- Explain clearly:
  • Who is eligible
  • Why it matches the user
  • What benefit it offers
- If user lacks required details (state, income, category, etc), ask a follow-up question.
- Keep answers simple, structured, and practical.
- Use bullet points when helpful.
        `,
      },
      {
        role: "user",
        content: `
USER QUESTION:
${question}

RELEVANT SCHEMES:
${context}

Provide a clear, helpful response.
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