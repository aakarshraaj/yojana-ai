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
  memoryContext = "No profile",
  nextQuestion = null,
  mode = "list"
) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: `You are Yojana AI, a practical assistant for Indian government schemes.
Use only provided context.
Do not invent schemes.
If MODE is "list":
- Recommend 2-4 relevant schemes with short bullets.
- Mention eligibility probability for each.
If MODE is "focused":
- Discuss only the selected scheme in depth.
- Provide: who can apply, benefits, documents, how to apply online/offline, links, and practical next steps.
- Do not return a list of alternative schemes.
If NEXT QUESTION is provided, end with exactly that one question.`,
      },
      {
        role: "user",
        content: `Mode:\n${mode}\n\nUser question:\n${question}\n\nSaved profile:\n${memoryContext}\n\nNext question:\n${
          nextQuestion || "None"
        }\n\nRelevant schemes:\n${context}`,
      },
    ],
  });

  return completion.choices[0].message.content;
}

module.exports = {
  generateEmbedding,
  generateChatResponse,
};
