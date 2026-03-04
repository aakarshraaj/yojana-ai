const { generateEmbedding } = require("../../../../lib/openai");
const { searchSchemes } = require("../../../../lib/supabase");
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
    timeoutMs: 10000,
    retries: 1,
    label: "embed_complaint",
  });
  const rawMatches = await runWithRetry(() => searchSchemes(embedding), {
    timeoutMs: 10000,
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
    answer = `You are right. The previous response mixed the wrong state. I could not find strong ${mergedProfile.state || "state"}-specific matches right now, but I can retry with more profile details.`;
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
    const acknowledged = `You are right, that was incorrect. I should only show ${mergedProfile.state || "your state"} (or central) schemes.\n\n`;
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
