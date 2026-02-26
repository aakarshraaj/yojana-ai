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
    messages: [
      {
        role: "system",
        content:
          "You are an expert assistant helping Indian citizens find relevant government schemes. Be clear, practical, and structured.",
      },
      {
        role: "user",
        content: `
User question:
${question}

Relevant schemes:
${context}

Explain which schemes match and why. Keep it clear and helpful.
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