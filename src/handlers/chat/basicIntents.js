const {
  buildSmalltalkClarifier,
  buildPendingClarifier,
  buildOutOfScopeGuidance,
} = require("../../services/guidance");

function createBasicIntentHandlers() {
  return {
    smalltalk_noise: async ({ session, mergedProfile, toUserLanguage, respond }) => {
      session.lastAssistantAction = "clarify";
      session.pendingQuestion = "your exact request (discover, compare, or scheme details)";
      return respond({
        memory: mergedProfile,
        interview: { nextQuestion: null },
        answer: await buildSmalltalkClarifier(session, mergedProfile, toUserLanguage),
        matches: [],
      });
    },

    nonsense_noise: async ({ session, mergedProfile, toUserLanguage, respond }) => {
      session.lastAssistantAction = "clarify";
      session.pendingQuestion = "state and support type";
      return respond({
        memory: mergedProfile,
        interview: { nextQuestion: null },
        answer: await toUserLanguage(
          "I could not understand that text. Please write your request in a sentence, for example: 'I am from Maharashtra and need scholarship schemes.'"
        ),
        matches: [],
      });
    },

    unclear_ack: async ({ session, mergedProfile, toUserLanguage, respond }) => {
      session.lastAssistantAction = "clarify";
      session.pendingQuestion = session.pendingQuestion || "your exact request (discover, compare, or details)";
      return respond({
        memory: mergedProfile,
        interview: { nextQuestion: null },
        answer: await buildPendingClarifier(session, toUserLanguage),
        matches: [],
      });
    },

    out_of_scope: async ({ session, mergedProfile, toUserLanguage, respond }) => {
      const offTopicCount = Number(session.offTopicCount || 0) + 1;
      session.offTopicCount = offTopicCount;
      session.lastAssistantAction = "out_of_scope";
      session.pendingQuestion = null;

      if (offTopicCount >= 2) {
        return respond({
          memory: mergedProfile,
          interview: { nextQuestion: null },
          answer: await toUserLanguage(
            "I am only for government scheme guidance, so I will pause this thread here. If you want to continue, send your state and what support you need."
          ),
          matches: [],
        });
      }

      return respond({
        memory: mergedProfile,
        interview: { nextQuestion: null },
        answer: await buildOutOfScopeGuidance(toUserLanguage, mergedProfile),
        matches: [],
      });
    },
  };
}

module.exports = {
  createBasicIntentHandlers,
};
