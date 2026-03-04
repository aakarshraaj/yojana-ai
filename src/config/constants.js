/**
 * Centralized configuration constants.
 * Env vars override where applicable.
 */

const MS = {
  SEC: 1000,
  MIN: 60 * 1000,
  HOUR: 60 * 60 * 1000,
  DAY: 24 * 60 * 60 * 1000,
};

module.exports = {
  // Validation
  QUESTION_MAX_LENGTH: 5000,
  MESSAGE_MAX_LENGTH: 5000,
  SESSION_ID_MAX_LENGTH: 100,

  // Session
  SESSION_TTL_MS: Number(process.env.SESSION_TTL_MS) || MS.DAY,
  MAX_SESSIONS: 5000,

  // Server
  DEFAULT_PORT: 3000,

  // Geography cache
  GEO_CACHE_TTL_MS: 5 * MS.MIN,

  // Vector search (Supabase)
  VECTOR_SEARCH_THRESHOLDS: [0.5, 0.35, 0.2, 0.0],
  VECTOR_MATCH_COUNT: 15,
  VECTOR_RETRY_DELAYS_MS: [250, 700, 1500],

  // Timeouts (ms)
  TIMEOUT_PARSE_MS: 8000,
  TIMEOUT_FORMAT_MS: 8000,
  TIMEOUT_TRANSLATE_MS: 8000,
  TIMEOUT_EMBED_MS: 10000,
  TIMEOUT_SEARCH_MS: 10000,
  TIMEOUT_INTENT_MS: 6000,
  TIMEOUT_CHAT_MS: 12000,
};
