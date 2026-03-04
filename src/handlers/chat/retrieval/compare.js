const { profileText } = require("../../../services/profile");
const { normalizeMatches, findCompareSchemes, scoreMatch, buildCompareContext, choiceSummary } = require("../../../services/scheme");
const { mapMatchBasic, mapMatchScored } = require("../mappers");

async function handleCompareRequest({
  session,
  canonicalQuestion,
  mergedProfile,
  previousMatches,
  toUserLanguage,
  respond,
  generateValidatedModeAnswer,
  geographyService,
}) {
  const comparePair = findCompareSchemes(canonicalQuestion, previousMatches);
  if (comparePair.length === 2) {
    const a = await scoreMatch(comparePair[0], mergedProfile, { geographyService });
    const b = await scoreMatch(comparePair[1], mergedProfile, { geographyService });
    const context = buildCompareContext(a, b);
    const answer = await generateValidatedModeAnswer({
      question: canonicalQuestion,
      context,
      memoryContext: profileText(mergedProfile),
      mode: "compare",
      intent: "compare_request",
      fallbackAnswer: `Comparison summary:\n\nA) ${a.name}\nB) ${b.name}\n\nPlease ask for eligibility/documents/apply steps for either scheme.`,
    });
    session.lastAssistantAction = "compare";
    session.pendingQuestion = null;
    return respond({
      memory: mergedProfile,
      interview: { nextQuestion: null },
      answer: await toUserLanguage(answer),
      matches: [a, b].map(mapMatchScored),
    });
  }

  session.lastAssistantAction = "clarify";
  session.pendingQuestion = "which two schemes to compare";
  return respond({
    memory: mergedProfile,
    interview: { nextQuestion: null },
    answer: await toUserLanguage(
      `Tell me exactly which two schemes you want to compare.\n\nRecent options:\n${choiceSummary(previousMatches)}`
    ),
    matches: normalizeMatches(previousMatches).slice(0, 4).map(mapMatchBasic),
  });
}

module.exports = {
  handleCompareRequest,
};
