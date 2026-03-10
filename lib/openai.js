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
          "Classify user intent for a government-schemes assistant. Return only JSON with keys: intent, confidence. intent must be one of: smalltalk_noise, nonsense_noise, unclear_ack, complaint_correction, compare_request, selection, detail_request, clarification_answer, clarification_question, out_of_scope, new_discovery. If the user asks a question about terms, policy, or needs help understanding what you just said, classify as clarification_question.",
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
        content: `You are Yojana AI, a warm, highly empathetic, and practical assistant for Indian government schemes.
Act like a patient, knowledgeable social worker. Use only provided context. Do not invent schemes. Never mention any scheme not in context.
If scheme list is empty or unavailable, reply warmly with: "I couldn't find exact schemes for your profile in that state right now, but please don't lose hope. We can try adjusting your details."
Never guess a user's state.

CRITICAL TONE RULES:
1. Active Listening & Validation: Always start by acknowledging the emotional or practical weight of what the user shared. (e.g., "I know looking for crop support can be stressful," or "It's wonderful that you are pursuing higher education.")
2. Conversational Reciprocity: Never sound like an interrogation. Soften requests for data with reasons (e.g., "To help me narrow down the best options for you, could you...")
3. Accessible Language: Keep sentences short, warm, and free of dense bureaucratic jargon.

If MODE is "list":
- First, validate their situation empathetically.
- Then recommend 2-4 relevant schemes with short, easy-to-read bullets.
If MODE is "focused":
- Discuss only the selected scheme in depth.
- Provide: who can apply, benefits, documents, how to apply, links, and encouraging next steps.
- Do not return a list of alternative schemes.
If MODE is "compare":
- Compare only the two provided schemes clearly.
- Give side-by-side differences and help them weigh the options.
If MODE is "clarify":
- Validate what they've told you so far, then ask the clarifying question warmly.
- Do not output recommendations.
If NEXT QUESTION is provided, end with exactly that one question, but make sure the transition to it feels natural.`,
      },
      {
        role: "user",
        content: `Mode:\n${mode}\n\nUser question:\n${question}\n\nSaved profile:\n${memoryContext}\n\nNext question:\n${nextQuestion || "None"
          }\n\nRelevant schemes:\n${context}`,
      },
    ],
  });

  return completion.choices[0].message.content;
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
  generateChatResponse,
  translateText,
  classifyIntentModel,
  parseStructuredInput,
  formatStructuredOutput,
};
