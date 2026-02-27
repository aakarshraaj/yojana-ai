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

async function translateText(text, targetLanguage) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "You are a translation engine. Translate accurately and naturally. Return only translated text, no explanations.",
      },
      {
        role: "user",
        content: `Translate to ${targetLanguage}:\n\n${text}`,
      },
    ],
  });

  return completion.choices[0].message.content;
}

async function classifyIntentModel(question, context = {}) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Classify user intent for a government-schemes assistant. Return only JSON with keys: intent, confidence. intent must be one of: smalltalk_noise, nonsense_noise, unclear_ack, complaint_correction, compare_request, selection, detail_request, clarification_answer, new_discovery.",
      },
      {
        role: "user",
        content: JSON.stringify({ question, context }),
      },
    ],
  });

  const raw = completion.choices[0].message.content || "{}";
  try {
    return JSON.parse(raw);
  } catch {
    return { intent: "new_discovery", confidence: 0.5 };
  }
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
If MODE is "compare":
- Compare only the two provided schemes.
- Give side-by-side differences: eligibility, benefits, documents, where to apply, and who should choose which.
If MODE is "clarify":
- Ask a concise clarifying question only.
- Do not output recommendations.
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
  translateText,
  classifyIntentModel,
};
