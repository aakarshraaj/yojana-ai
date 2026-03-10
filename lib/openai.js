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


async function parseStructuredInput(message, context = {}) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a strict intent and profile parser for a government scheme assistant.

Your job is to extract structured data only.

Return JSON only with this exact schema:

{
  "intent": "RECOMMEND | DETAILS | COMPARE | UPDATE_PROFILE | UNKNOWN",
  "profile_updates": {
    "state": null,
    "city": null,
    "age": null,
    "category": null,
    "occupation": null,
    "income": null,
    "need": null
  },
  "selection_filters": {
    "category": null,
    "level": null,
    "quantity": null
  },
  "confidence": number
}

Rules:
- Do NOT generate explanations.
- Do NOT generate scheme names.
- Extract any structured profile data provided.
- If the user describes a hardship (e.g., "lost my job", "can't pay fees", "medical emergency"), infer a general 'need' category (e.g., "unemployment", "scholarship", "health") and set it in "need".
- If unsure, set fields to null.
- confidence must be between 0 and 1.

Additional intent rules:
- DETAILS only when user references a specific visible scheme by name, index/ordinal (first/second/1st/2nd), or explicit phrase like "details of X".
- Generic requests such as "need schemes", "show me schemes", "scholarship schemes", "find schemes" MUST be RECOMMEND.
- If there is no clear selection reference, do NOT return DETAILS.`,
      },
      {
        role: "user",
        content: JSON.stringify({ message, context }),
      },
    ],
  });

  const raw = completion.choices[0].message.content || "{}";
  return JSON.parse(raw);
}

async function formatStructuredOutput(payload) {
  const mode = String(payload?.mode || "").toUpperCase();
  if (mode === "NO_RESULTS") {
    const state = String(payload?.profile?.state || "").trim();
    const stateText = state || "your state";
    return `No schemes found for your profile in ${stateText}. You may adjust category, occupation, or level.`;
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: `You are an empathetic formatter for a government scheme assistant.
You must ONLY describe the schemes provided but do so warmly and naturally.
If mode is "NO_RESULTS", respond gently:
"I couldn't find schemes matching your exact profile in {state} right now. Sometimes adjusting the category or occupation helps uncover different options."
Replace {state} with profile.state from input.
If mode is "SHOW_LIST":
- Use an warm, exploratory, encouraging tone.
- Summarize top schemes for the user's state/profile in a way that feels helpful, not robotic.
- End with: "You can select any of these schemes to learn more about how to apply."
- Do NOT ask for exact scheme name.
If schemes array is empty, respond gently:
"I couldn't find schemes for this exact profile right now."
Return plain text only.`,
      },
      {
        role: "user",
        content: JSON.stringify(payload),
      },
    ],
  });

  return completion.choices[0].message.content || "";
}

module.exports = {
  generateEmbedding,
  parseStructuredInput,
  formatStructuredOutput,
};
