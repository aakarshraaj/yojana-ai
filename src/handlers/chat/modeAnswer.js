const { generateChatResponse } = require("../../../lib/openai");
const { TIMEOUT_CHAT_MS } = require("../../config/constants");

function validateGeneratedAnswer(answer, mode, intent) {
  const text = String(answer || "").toLowerCase();
  if (intent === "complaint_correction") {
    return /(you are right|you’re right|you are correct|sorry|apologize)/.test(text);
  }
  if (mode === "list") return /(1\.\s|2\.\s|eligibility probability|here are)/.test(text);
  if (mode === "focused") return !/(1\.\s|2\.\s|here are some relevant schemes)/.test(text);
  if (mode === "compare") return /(scheme a|scheme b|difference|compared|versus|vs)/.test(text);
  if (mode === "clarify") return !/(1\.\s|2\.\s|eligibility probability|here are)/.test(text);
  return true;
}

function createGenerateValidatedModeAnswer({ runWithRetry }) {
  return async function generateValidatedModeAnswer({
    question,
    context,
    memoryContext,
    nextQuestion = null,
    mode,
    intent,
    fallbackAnswer,
  }) {
    const first = await runWithRetry(
      () => generateChatResponse(question, context, memoryContext, nextQuestion, mode),
      { timeoutMs: TIMEOUT_CHAT_MS, retries: 0, label: "chat_generation_first" }
    );
    if (validateGeneratedAnswer(first, mode, intent)) return first;

    const strictQuestion = `STRICT MODE (${mode}) - do not violate mode rules.\n\n${question}`;
    const second = await runWithRetry(
      () => generateChatResponse(strictQuestion, context, memoryContext, nextQuestion, mode),
      { timeoutMs: TIMEOUT_CHAT_MS, retries: 0, label: "chat_generation_second" }
    );
    if (validateGeneratedAnswer(second, mode, intent)) return second;

    return fallbackAnswer;
  };
}

module.exports = {
  validateGeneratedAnswer,
  createGenerateValidatedModeAnswer,
};
