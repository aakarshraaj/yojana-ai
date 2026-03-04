const { translateText, classifyIntentModel } = require("../../lib/openai");
const {
  createProfileService,
  mergeProfile,
  detectProfileConflict,
  parseLeadingDecision,
  isAffirmativeText,
  isNegativeText,
  isUndoProfileChangeCommand,
  hasProfileSignal,
  getNextQuestion,
  detectBlankProfileTemplate,
  isResetCommand,
  isDisengageText,
} = require("../services/profile");
const { normalizeText, extractSelectionIndex, findFocusedScheme } = require("../services/scheme");
const { classifyIntentSmart, hasSchemeDomainSignal, discoverySignal } = require("../services/intent");
const {
  buildPurposeGuidance,
  buildContextualGuidance,
  buildProgressClarifier,
} = require("../services/guidance");
const { createGenerateValidatedModeAnswer } = require("./chat/modeAnswer");
const { TIMEOUT_TRANSLATE_MS } = require("../config/constants");
const { createBasicIntentHandlers } = require("./chat/basicIntents");
const { handleRetrievalFlow } = require("./chat/retrievalFlow");

function createChatHandler({ getSession, runWithRetry, profileService, geographyService }) {
  const resolvedProfileService = profileService || createProfileService();
  const generateValidatedModeAnswer = createGenerateValidatedModeAnswer({ runWithRetry });
  const basicIntentHandlers = createBasicIntentHandlers();

  async function translateToEnglish(text) {
    return runWithRetry(() => translateText(text, "English"), { timeoutMs: TIMEOUT_TRANSLATE_MS, retries: 1, label: "translate_en" });
  }

  async function translateToHindi(text) {
    return runWithRetry(() => translateText(text, "Hindi"), { timeoutMs: TIMEOUT_TRANSLATE_MS, retries: 1, label: "translate_hi" });
  }

  async function translateToMarathi(text) {
    return runWithRetry(() => translateText(text, "Marathi"), { timeoutMs: TIMEOUT_TRANSLATE_MS, retries: 1, label: "translate_mr" });
  }

  return async function chatHandler(req, res) {
    try {
      const { question, language = "en", sessionId: sessionIdInput } = req.body;
      const normalizedLanguageInput = String(language || "en").toLowerCase();
      const normalizedLanguage =
        normalizedLanguageInput === "marathi"
          ? "mr"
          : normalizedLanguageInput === "hindi"
            ? "hi"
            : normalizedLanguageInput;

      const toUserLanguage = async (text) => {
        if (!text) return text;
        if (normalizedLanguage === "hi") return translateToHindi(text);
        if (normalizedLanguage === "mr") return translateToMarathi(text);
        return text;
      };

      let canonicalQuestion = question;
      if (normalizedLanguage === "hi" || normalizedLanguage === "mr") {
        canonicalQuestion = await translateToEnglish(question);
      }

      const { sessionId, session, sessionIdProvided } = getSession(sessionIdInput, req.user?.id || null);
      const respond = (payload) =>
        res.json({
          ...payload,
          sessionId,
          session: {
            sessionIdProvided,
            continuityHint: sessionIdProvided
              ? null
              : "Send this sessionId in the next request to preserve conversation context.",
          },
        });

      if (isResetCommand(canonicalQuestion)) {
        session.profile = {};
        session.selectedScheme = null;
        session.lastMatches = [];
        session.pendingQuestion = null;
        session.lastAssistantAction = "clarify";
        return respond({
          memory: session.profile,
          interview: { nextQuestion: await toUserLanguage("Which state do you live in?") },
          answer: await toUserLanguage("Done. I cleared saved profile and scheme context. Which state do you live in?"),
          matches: [],
        });
      }

      if (isUndoProfileChangeCommand(canonicalQuestion)) {
        if (session.lastProfileChange) {
          const undo = session.lastProfileChange;
          session.profile = {
            ...(session.profile || {}),
            [undo.field]: undo.from,
          };
          if (undo.field === "state") {
            session.selectedScheme = null;
            session.lastMatches = [];
          }
          session.lastProfileChange = null;
          session.pendingProfileChange = null;
          session.pendingQuestion = null;
          return respond({
            memory: session.profile,
            interview: { nextQuestion: null },
            answer: await toUserLanguage(`Reverted ${undo.field} back to ${undo.from}.`),
            matches: [],
          });
        }
        return respond({
          memory: session.profile || {},
          interview: { nextQuestion: null },
          answer: await toUserLanguage("There is no recent profile change to undo."),
          matches: [],
        });
      }

      if (detectBlankProfileTemplate(question)) {
        session.lastAssistantAction = "clarify";
        session.pendingQuestion = "fill state, age, category, occupation, income, and need";
        return respond({
          memory: session.profile || {},
          interview: { nextQuestion: null },
          answer: await toUserLanguage(
            "I received a blank profile template. Please fill at least State and Need (for example: State: Maharashtra, Need: scholarship for engineering student)."
          ),
          matches: [],
        });
      }

      if (session.pendingProfileChange) {
        const pending = session.pendingProfileChange;
        const parsedDecision = parseLeadingDecision(canonicalQuestion);
        if (parsedDecision.decision === "yes" || isAffirmativeText(canonicalQuestion)) {
          session.profile = {
            ...(session.profile || {}),
            [pending.field]: pending.to,
          };
          session.lastProfileChange = pending;
          session.pendingProfileChange = null;
          session.pendingQuestion = null;
          if (pending.field === "state") {
            session.selectedScheme = null;
            session.lastMatches = [];
          }
          if (!parsedDecision.remainder) {
            const nextQuestion = getNextQuestion(session.profile || {});
            const localizedNextQuestion = nextQuestion ? await toUserLanguage(nextQuestion) : null;
            const answer = nextQuestion
              ? `Updated ${pending.field} to ${pending.to}. ${nextQuestion}`
              : `Updated ${pending.field} to ${pending.to}. Tell me what support you need next.`;
            return respond({
              memory: session.profile,
              interview: { nextQuestion: localizedNextQuestion },
              answer: await toUserLanguage(answer),
              matches: [],
            });
          }
          canonicalQuestion = parsedDecision.remainder;
        } else if (parsedDecision.decision === "no" || isNegativeText(canonicalQuestion)) {
          session.pendingProfileChange = null;
          session.pendingQuestion = null;
          if (!parsedDecision.remainder) {
            const nextQuestion = getNextQuestion(session.profile || {});
            const localizedNextQuestion = nextQuestion ? await toUserLanguage(nextQuestion) : null;
            const answer = nextQuestion
              ? `Okay, I will keep your ${pending.field} as ${pending.from}. ${nextQuestion}`
              : `Okay, I will keep your ${pending.field} as ${pending.from}. Tell me what support you need next.`;
            return respond({
              memory: session.profile || {},
              interview: { nextQuestion: localizedNextQuestion },
              answer: await toUserLanguage(answer),
              matches: [],
            });
          }
          canonicalQuestion = parsedDecision.remainder;
        } else {
          return respond({
            memory: session.profile || {},
            interview: { nextQuestion: null },
            answer: await toUserLanguage(
              `Please confirm: change ${pending.field} from ${pending.from} to ${pending.to}? Reply yes or no.`
            ),
            matches: [],
          });
        }
      }

      const extractedThisTurn = await resolvedProfileService.extractProfile(canonicalQuestion);
      const previousProfile = session.profile || {};
      const profileConflict = detectProfileConflict(previousProfile, extractedThisTurn);
      if (profileConflict) {
        session.pendingProfileChange = profileConflict;
        session.lastAssistantAction = "clarify";
        session.pendingQuestion = "confirm profile change";
        return respond({
          memory: previousProfile,
          interview: { nextQuestion: null },
          answer: await toUserLanguage(
            `I heard a ${profileConflict.field} change from ${profileConflict.from} to ${profileConflict.to}. Should I update it? Reply yes or no.`
          ),
          matches: [],
        });
      }

      const mergedProfile = mergeProfile(previousProfile, extractedThisTurn);
      session.profile = mergedProfile;
      session.updatedAt = Date.now();
      const previousMatches = Array.isArray(session.lastMatches) ? session.lastMatches : [];
      const previousSelectedScheme = session.selectedScheme || null;
      const turnProfileSignal = hasProfileSignal(extractedThisTurn);

      if (isDisengageText(canonicalQuestion)) {
        session.lastAssistantAction = "paused";
        session.pendingQuestion = null;
        return respond({
          memory: mergedProfile,
          interview: { nextQuestion: null },
          answer: await toUserLanguage(
            "No problem. I will pause here. If you want to continue later, send your state and need, or ask details for a scheme name."
          ),
          matches: [],
        });
      }

      const intentMeta = await classifyIntentSmart(canonicalQuestion, session, {
        classifyIntentModel,
        runWithRetry,
      });
      let intent = intentMeta.intent;
      const hasSelectionFromHistory =
        previousMatches.length > 0 &&
        (extractSelectionIndex(canonicalQuestion) != null || !!findFocusedScheme(canonicalQuestion, previousMatches));
      if (hasSelectionFromHistory) intent = "selection";

      const inDomainByText = await hasSchemeDomainSignal(canonicalQuestion, mergedProfile, { geographyService });
      if (intent === "out_of_scope" && inDomainByText) {
        intent = session.pendingQuestion ? "clarification_answer" : "new_discovery";
      }
      if ((intent === "smalltalk_noise" || intent === "unclear_ack") && turnProfileSignal) {
        intent = session.pendingQuestion ? "clarification_answer" : "new_discovery";
      }
      if (inDomainByText) session.offTopicCount = 0;

      const canonicalNormalized = normalizeText(canonicalQuestion);
      const isRepeatedLowSignal =
        session.lastCanonicalQuestion &&
        session.lastCanonicalQuestion === canonicalNormalized &&
        canonicalNormalized.split(" ").filter(Boolean).length <= 3;
      session.lastCanonicalQuestion = canonicalNormalized;

      const log = req.log;
      if (log) {
        log.info(
          {
            sessionId,
            intent,
            intentConfidence: intentMeta.confidence,
            intentSource: intentMeta.source || "rule",
            profileState: mergedProfile.state || null,
          },
          "chat_turn"
        );
      }

      if (isRepeatedLowSignal) {
        session.lastAssistantAction = "clarify";
        session.pendingQuestion = session.pendingQuestion || "what you need help with";
        return respond({
          memory: mergedProfile,
          interview: { nextQuestion: null },
          answer: await toUserLanguage("I still need a specific request. Tell me your state and what scheme help you want."),
          matches: [],
        });
      }

      if (intent === "clarification_answer" && intentMeta.confidence < 0.75) {
        session.lastAssistantAction = "clarify";
        session.pendingQuestion = "state and exact support you need";
        return respond({
          memory: mergedProfile,
          interview: { nextQuestion: null },
          answer: await buildPurposeGuidance(toUserLanguage),
          matches: [],
        });
      }

      if (basicIntentHandlers[intent]) {
        return basicIntentHandlers[intent]({ session, mergedProfile, toUserLanguage, respond });
      }

      const retrievalIntent = new Set([
        "new_discovery",
        "compare_request",
        "selection",
        "detail_request",
        "complaint_correction",
      ]);
      if (retrievalIntent.has(intent) && !mergedProfile.state) {
        session.lastAssistantAction = "clarify";
        session.pendingQuestion = "which state do you live in";
        return respond({
          memory: mergedProfile,
          interview: { nextQuestion: await toUserLanguage("Which state do you live in?") },
          answer: await toUserLanguage(
            "Please tell me your state first (or city name). I only show schemes after state is identified."
          ),
          matches: [],
        });
      }

      const explicitUserAsk = /(scheme|yojana|benefit|scholarship|upsc|exam|coaching|loan|support|help)/i.test(
        canonicalQuestion
      );
      if (intent === "new_discovery" && discoverySignal(canonicalQuestion, mergedProfile, session) < 3 && !explicitUserAsk) {
        session.lastAssistantAction = "clarify";
        session.pendingQuestion = "state and the support type you need";
        const targetedPrompt = hasProfileSignal(mergedProfile)
          ? await buildProgressClarifier(mergedProfile, toUserLanguage)
          : await buildContextualGuidance(canonicalQuestion, mergedProfile, toUserLanguage);
        return respond({ memory: mergedProfile, interview: { nextQuestion: null }, answer: targetedPrompt, matches: [] });
      }

      return handleRetrievalFlow({
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
      });
    } catch (err) {
      const log = req.log;
      if (log) {
        log.error({ err: err?.message, stack: err?.stack }, "CHAT_HANDLER_ERROR");
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  };
}

module.exports = {
  createChatHandler,
};
