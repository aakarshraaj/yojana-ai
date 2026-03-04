const { generateEmbedding } = require("../../../../lib/openai");
const { searchSchemes } = require("../../../../lib/supabase");
const { profileText, getNextQuestion } = require("../../../services/profile");
const {
  normalizeMatches,
  extractSelectionIndex,
  pickBySelectionIndex,
  choiceSummary,
  findFocusedScheme,
  applyStateGuardrails,
  rankMatches,
  buildFocusedContext,
  buildDeterministicList,
  sanitizeAnswerWithMatches,
  buildContext,
} = require("../../../services/scheme");
const { mapMatchBasic, mapMatchScored } = require("../mappers");

async function handleDiscoveryAndDetails({
  intent,
  session,
  canonicalQuestion,
  mergedProfile,
  previousMatches,
  previousSelectedScheme,
  toUserLanguage,
  respond,
  runWithRetry,
  generateValidatedModeAnswer,
  geographyService,
}) {
  const query = `${canonicalQuestion}\n\nKnown profile: ${profileText(mergedProfile)}`;
  const embedding = await runWithRetry(() => generateEmbedding(query), {
    timeoutMs: 10000,
    retries: 1,
    label: "embed",
  });
  const rawMatches = await runWithRetry(() => searchSchemes(embedding), {
    timeoutMs: 10000,
    retries: 1,
    label: "search",
  });
  const guarded = await applyStateGuardrails(rawMatches, mergedProfile, { geographyService });
  const matches = await rankMatches(guarded.matches, mergedProfile, { geographyService });
  session.lastMatches = matches.slice(0, 10);
  session.lastError = guarded.mismatchDetected ? "state_mismatch_detected" : null;

  const nextQuestion = getNextQuestion(mergedProfile);
  const localizedNextQuestion = nextQuestion ? await toUserLanguage(nextQuestion) : null;

  if (!matches.length) {
    if (intent === "detail_request" && previousMatches.length) {
      session.lastAssistantAction = "clarify";
      session.pendingQuestion = "which scheme do you mean";
      return respond({
        memory: mergedProfile,
        interview: { nextQuestion: null },
        answer: await toUserLanguage(
          `I can help with that, but please tell me which scheme you mean.\n\nRecent options:\n${choiceSummary(previousMatches)}`
        ),
        matches: normalizeMatches(previousMatches).slice(0, 4).map(mapMatchBasic),
      });
    }

    session.lastAssistantAction = "clarify";
    session.pendingQuestion = nextQuestion || null;
    const noResultMessage = mergedProfile.state
      ? `No schemes found for your current profile in ${mergedProfile.state}. Please refine category/income/need, or try a broader need.`
      : nextQuestion || "I could not find relevant schemes right now. Please try another wording or share more details.";
    return respond({
      memory: mergedProfile,
      interview: { nextQuestion: localizedNextQuestion },
      answer: await toUserLanguage(noResultMessage),
      matches: [],
    });
  }

  const focusedFromCurrent =
    pickBySelectionIndex(matches, extractSelectionIndex(canonicalQuestion)) ||
    findFocusedScheme(canonicalQuestion, matches);
  if ((intent === "detail_request" || intent === "selection") && !focusedFromCurrent && !previousSelectedScheme) {
    session.lastAssistantAction = "clarify";
    session.pendingQuestion = "scheme name for details";
    return respond({
      memory: mergedProfile,
      interview: { nextQuestion: null },
      answer: await toUserLanguage(
        `Please tell me the exact scheme name you want details for.\n\nTop options:\n${choiceSummary(matches)}`
      ),
      matches: matches.slice(0, 4).map(mapMatchScored),
    });
  }

  if ((intent === "detail_request" || intent === "selection") && focusedFromCurrent) {
    session.selectedScheme = focusedFromCurrent;
    const focusedContext = buildFocusedContext(focusedFromCurrent);
    const answer = await generateValidatedModeAnswer({
      question: canonicalQuestion,
      context: focusedContext,
      memoryContext: profileText(mergedProfile),
      mode: "focused",
      intent,
      fallbackAnswer: `Here are details for ${focusedFromCurrent.name}:\n\n${focusedContext}`,
    });
    session.lastAssistantAction = "focused";
    session.pendingQuestion = null;
    return respond({
      memory: mergedProfile,
      interview: { nextQuestion: null },
      answer: await toUserLanguage(answer),
      selectedScheme: focusedFromCurrent.name,
      matches: matches.map(mapMatchScored),
    });
  }

  const context = buildContext(matches);
  const listAnswer = await generateValidatedModeAnswer({
    question: canonicalQuestion,
    context,
    memoryContext: profileText(mergedProfile),
    nextQuestion,
    mode: "list",
    intent,
    fallbackAnswer: buildDeterministicList(matches, mergedProfile.state),
  });
  const localizedAnswer = await toUserLanguage(listAnswer);
  session.lastAssistantAction = "list";
  session.pendingQuestion = nextQuestion || null;

  return respond({
    memory: mergedProfile,
    interview: { nextQuestion: localizedNextQuestion },
    answer: sanitizeAnswerWithMatches(localizedAnswer, matches),
    quality: { stateMismatchDetected: guarded.mismatchDetected, droppedForState: guarded.droppedCount },
    matches: matches.map(mapMatchScored),
  });
}

module.exports = {
  handleDiscoveryAndDetails,
};
