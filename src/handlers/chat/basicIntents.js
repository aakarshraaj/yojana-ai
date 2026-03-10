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

    clarification_question: async ({ session, mergedProfile, toUserLanguage, respond }) => {
      // Don't change session.pendingQuestion or lastAssistantAction. Let the retrieval flow
      // or chat loop answer this dynamically, or provide a canned fallback if needed, but return to the pending question.
      const reminder = session.pendingQuestion ? await toUserLanguage(session.pendingQuestion) : "";

      // For now, since we don't have a RAG knowledge base for general concept questions ready yet, we output a standard fallback.
      // In next iteration we could query LLM directly for definitions. Here we gently redirect back.
      return respond({
        memory: mergedProfile,
        interview: { nextQuestion: null },
        answer: await toUserLanguage(
          "I am a specialized agent designed to find schemes based on profiles. Could you answer the following to help me find schemes for you? " + reminder
        ),
        matches: [],
      });
    },
  };
}

module.exports = {
  createBasicIntentHandlers,
};
