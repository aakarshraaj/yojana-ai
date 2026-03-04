const { randomUUID } = require("crypto");

function createSessionManager({ ttlMs = 1000 * 60 * 60 * 24, maxSessions = 5000 } = {}) {
  const sessionStore = new Map();

  function getSession(sessionIdInput, userId = null) {
    const provided = typeof sessionIdInput === "string" && sessionIdInput.trim().length > 0;
    let sessionId;
    if (userId) {
      sessionId = provided ? `${userId}:${sessionIdInput.trim()}` : userId;
    } else {
      sessionId = provided ? sessionIdInput.trim() : randomUUID();
    }

    const now = Date.now();
    const existing = sessionStore.get(sessionId);
    if (existing && now - Number(existing.updatedAt || 0) <= ttlMs) {
      existing.updatedAt = now;
      return { sessionId, session: existing, sessionIdProvided: provided };
    }

    const session = { profile: {}, updatedAt: now };
    sessionStore.set(sessionId, session);

    if (sessionStore.size > maxSessions) {
      for (const [key, value] of sessionStore.entries()) {
        if (now - Number(value?.updatedAt || 0) > ttlMs) sessionStore.delete(key);
      }
    }

    return { sessionId, session, sessionIdProvided: provided };
  }

  return {
    getSession,
    store: sessionStore,
  };
}

module.exports = {
  createSessionManager,
};
