const { profileText } = require("../../../services/profile");
const {
  normalizeMatches,
  extractSelectionIndex,
  pickBySelectionIndex,
  findFocusedScheme,
  scoreMatch,
  buildFocusedContext,
} = require("../../../services/scheme");
const { mapMatchScored } = require("../mappers");

async function maybeHandleFocusedFromHistory({
  intent,
  session,
  canonicalQuestion,
  mergedProfile,
  previousMatches,
  previousSelectedScheme,
  toUserLanguage,
  respond,
  generateValidatedModeAnswer,
  geographyService,
}) {
  if (intent === "selection" && previousMatches.length) {
    const selectedByIndex = pickBySelectionIndex(previousMatches, extractSelectionIndex(canonicalQuestion));
    const selected =
      selectedByIndex ||
      findFocusedScheme(canonicalQuestion, previousMatches) ||
      normalizeMatches(previousMatches)[0] ||
      null;

    if (selected) {
      const ranked = await scoreMatch(selected, mergedProfile, { geographyService });
      session.selectedScheme = ranked;
      const context = buildFocusedContext(ranked);
      const answer = await generateValidatedModeAnswer({
        question: canonicalQuestion,
        context,
        memoryContext: profileText(mergedProfile),
        mode: "focused",
        intent,
        fallbackAnswer: `Here are details for ${ranked.name}:\n\n${context}`,
      });
      session.lastAssistantAction = "focused";
      session.pendingQuestion = null;
      return respond({
        memory: mergedProfile,
        interview: { nextQuestion: null },
        answer: await toUserLanguage(answer),
        selectedScheme: ranked.name,
        matches: [mapMatchScored(ranked)],
      });
    }
  }

  const focusedFromHistory =
    pickBySelectionIndex(previousMatches, extractSelectionIndex(canonicalQuestion)) ||
    findFocusedScheme(canonicalQuestion, previousMatches);
  const stickyFocusedScheme =
    focusedFromHistory || (intent === "detail_request" && previousSelectedScheme ? previousSelectedScheme : null);

  if ((intent === "detail_request" || intent === "selection") && previousSelectedScheme && !focusedFromHistory) {
    const forcedFocused = await scoreMatch(previousSelectedScheme, mergedProfile, { geographyService });
    session.selectedScheme = forcedFocused;
    const focusedContext = buildFocusedContext(forcedFocused);
    const answer = await generateValidatedModeAnswer({
      question: canonicalQuestion,
      context: focusedContext,
      memoryContext: profileText(mergedProfile),
      mode: "focused",
      intent,
      fallbackAnswer: `Here are details for ${forcedFocused.name}:\n\n${focusedContext}`,
    });
    session.lastAssistantAction = "focused";
    session.pendingQuestion = null;
    return respond({
      memory: mergedProfile,
      interview: { nextQuestion: null },
      answer: await toUserLanguage(answer),
      selectedScheme: forcedFocused.name,
      matches: [mapMatchScored(forcedFocused)],
    });
  }

  if (intent === "detail_request" && stickyFocusedScheme) {
    const focusedRanked = await scoreMatch(stickyFocusedScheme, mergedProfile, { geographyService });
    session.selectedScheme = focusedRanked;
    const focusedContext = buildFocusedContext(focusedRanked);
    const answer = await generateValidatedModeAnswer({
      question: canonicalQuestion,
      context: focusedContext,
      memoryContext: profileText(mergedProfile),
      mode: "focused",
      intent,
      fallbackAnswer: `Here are details for ${focusedRanked.name}:\n\n${focusedContext}`,
    });
    session.lastAssistantAction = "focused";
    session.pendingQuestion = null;
    return respond({
      memory: mergedProfile,
      interview: { nextQuestion: null },
      answer: await toUserLanguage(answer),
      selectedScheme: focusedRanked.name,
      matches: [mapMatchScored(focusedRanked)],
    });
  }

  return null;
}

module.exports = {
  maybeHandleFocusedFromHistory,
};
