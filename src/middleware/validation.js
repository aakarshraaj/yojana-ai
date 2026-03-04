const { QUESTION_MAX_LENGTH, SESSION_ID_MAX_LENGTH, MESSAGE_MAX_LENGTH } = require("../config/constants");

function containsLikelyXSS(text) {
  return /<script|<iframe|javascript:/i.test(String(text || ""));
}

function validateChatRequest(req, res, next) {
  const { question, language, sessionId } = req.body || {};
  const errors = [];

  if (typeof question !== "string" || question.trim().length === 0) {
    errors.push("question is required");
  } else {
    if (question.length > QUESTION_MAX_LENGTH) errors.push(`question exceeds ${QUESTION_MAX_LENGTH} characters`);
    if (containsLikelyXSS(question)) errors.push("question contains invalid content");
  }

  if (language != null) {
    const normalizedLanguage = String(language).toLowerCase();
    const allowed = new Set(["en", "hi", "mr", "hindi", "marathi"]);
    if (!allowed.has(normalizedLanguage)) {
      errors.push("language must be one of: en, hi, mr, hindi, marathi");
    }
  }

  if (sessionId != null) {
    if (typeof sessionId !== "string" || sessionId.length > SESSION_ID_MAX_LENGTH) {
      errors.push("invalid sessionId");
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({ error: "Invalid request", details: errors });
  }

  return next();
}

function validateParseRequest(req, res, next) {
  const { message } = req.body || {};
  if (typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ error: "message is required" });
  }
  if (message.length > MESSAGE_MAX_LENGTH || containsLikelyXSS(message)) {
    return res.status(400).json({ error: "Invalid message" });
  }
  return next();
}

module.exports = {
  validateChatRequest,
  validateParseRequest,
};
