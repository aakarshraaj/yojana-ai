const { generateEmbedding } = require("../../../../lib/openai");
const { searchSchemes } = require("../../../../lib/supabase");
const { TIMEOUT_EMBED_MS, TIMEOUT_SEARCH_MS } = require("../../../config/constants");
const { profileText } = require("../../../services/profile");
const {
  applyStateGuardrails,
  rankMatches,
  buildDeterministicList,
  buildContext,
  sanitizeAnswerWithMatches,
} = require("../../../services/scheme");
const { mapMatchScored } = require("../mappers");
const { validateGeneratedAnswer } = require("../modeAnswer");

async function handleComplaintCorrection({
  session,
  canonicalQuestion,
  mergedProfile,
  toUserLanguage,
  respond,
  runWithRetry,
  generateValidatedModeAnswer,
  geographyService,
}) {
  session.selectedScheme = null;
  const correctionQuery = mergedProfile.state
    ? `${canonicalQuestion}\n\nStrictly for state: ${mergedProfile.state}`
    : canonicalQuestion;
  const embedding = await runWithRetry(() => generateEmbedding(correctionQuery), {
    timeoutMs: TIMEOUT_EMBED_MS,
    retries: 1,
    label: "embed_complaint",
  });
  const rawMatches = await runWithRetry(() => searchSchemes(embedding), {
    timeoutMs: TIMEOUT_SEARCH_MS,
    retries: 1,
    label: "search_complaint",
  });
  const guarded = await applyStateGuardrails(rawMatches, mergedProfile, { geographyService });
  const matches = await rankMatches(guarded.matches, mergedProfile, { geographyService });
  session.lastMatches = matches.slice(0, 10);
  session.lastAssistantAction = "complaint_correction";
  session.lastError = guarded.mismatchDetected ? "state_mismatch_detected" : null;
  session.pendingQuestion = null;

  let answer;
  if (!matches.length) {
    answer = `You are completely right, and I apologize for missing that. I couldn't find strong ${mergedProfile.state || "state"}-specific matches right now, but I can definitely retry if we adjust some profile details.`;
  } else {
    const context = buildContext(matches);
    const modelAnswer = await generateValidatedModeAnswer({
      question: canonicalQuestion,
      context,
      memoryContext: profileText(mergedProfile),
      mode: "list",
      intent: "complaint_correction",
      fallbackAnswer: buildDeterministicList(matches, mergedProfile.state),
    });
    const acknowledged = `You're completely right. I apologize for mixing that up! Let's fix that immediately. Here are the ones strictly for ${mergedProfile.state || "your state"}:\n\n`;
    answer = validateGeneratedAnswer(modelAnswer, "list", "complaint_correction")
      ? acknowledged + modelAnswer
      : `${acknowledged}${buildDeterministicList(matches, mergedProfile.state)}`;
  }

  return respond({
    memory: mergedProfile,
    interview: { nextQuestion: null },
    answer: await toUserLanguage(sanitizeAnswerWithMatches(answer, matches)),
    quality: { stateMismatchDetected: guarded.mismatchDetected, droppedForState: guarded.droppedCount },
    matches: matches.map(mapMatchScored),
  });
}

module.exports = {
  handleComplaintCorrection,
};
