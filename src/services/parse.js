const { createProfileService, hasProfileSignal } = require("./profile");

const PARSE_INTENTS = new Set(["RECOMMEND", "DETAILS", "COMPARE", "UPDATE_PROFILE", "UNKNOWN"]);

async function fallbackParse(message, { profileService = createProfileService() } = {}) {
  const text = String(message || "");
  const extracted = await profileService.extractProfile(text);

  let intent = "UNKNOWN";
  if (/\b(compare|comparison|vs|versus|difference)\b/i.test(text)) {
    intent = "COMPARE";
  } else if (/\b(both|details?|detail|eligibility|documents?|apply|how to apply|scheme|yojana)\b/i.test(text)) {
    intent = /\bboth\b/i.test(text) ? "DETAILS" : "RECOMMEND";
  } else if (hasProfileSignal(extracted) || extracted.city) {
    intent = "UPDATE_PROFILE";
  }

  let selectionCategory = null;
  if (/\btribe|tribal|\bst\b|scheduled tribe\b/i.test(text)) selectionCategory = "ST";
  else if (/\bsc\b|scheduled caste\b/i.test(text)) selectionCategory = "SC";
  else if (/\bobc\b|other backward class\b|backward class\b/i.test(text)) selectionCategory = "OBC";
  else if (/\bews\b|economically weaker\b/i.test(text)) selectionCategory = "EWS";
  else if (/\bminority\b/i.test(text)) selectionCategory = "MINORITY";
  else if (/\bgeneral\b|open category\b/i.test(text)) selectionCategory = "GENERAL";

  let quantity = null;
  if (/\b(both|all|multiple|many)\b/i.test(text)) quantity = "MULTIPLE";
  else if (/\b(one|single|any one|either)\b/i.test(text)) quantity = "SINGLE";

  let level = null;
  if (/\bcentral\b/i.test(text)) level = "CENTRAL";
  else if (/\bstate\b/i.test(text)) level = "STATE";

  return {
    intent,
    profile_updates: {
      state: extracted.state || null,
      district: extracted.district || null,
      city: extracted.city || null,
      age: extracted.age ?? null,
      category: extracted.category ? String(extracted.category).toUpperCase() : null,
      occupation: extracted.profession || null,
      income: extracted.incomeAnnual ?? null,
      need: null,
    },
    selection_filters: {
      category: selectionCategory,
      level,
      quantity,
    },
    confidence: 0.55,
  };
}

function normalizeParseResponse(raw = {}) {
  const safe = raw && typeof raw === "object" ? raw : {};
  const profile = safe.profile_updates && typeof safe.profile_updates === "object" ? safe.profile_updates : {};
  const filters = safe.selection_filters && typeof safe.selection_filters === "object" ? safe.selection_filters : {};
  const normalizedIntent = PARSE_INTENTS.has(safe.intent) ? safe.intent : "UNKNOWN";
  const confidenceRaw = Number(safe.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0;

  return {
    intent: normalizedIntent,
    profile_updates: {
      state: profile.state ?? null,
      district: profile.district ?? null,
      city: profile.city ?? null,
      age: profile.age ?? null,
      category: profile.category ?? null,
      occupation: profile.occupation ?? null,
      income: profile.income ?? null,
      need: profile.need ?? null,
    },
    selection_filters: {
      category: filters.category ?? null,
      level: filters.level ?? null,
      quantity: filters.quantity ?? null,
    },
    confidence,
  };
}

module.exports = {
  fallbackParse,
  normalizeParseResponse,
};
