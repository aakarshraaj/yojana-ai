const { hasProfileSignal } = require("./profile");
const { normalizeText, tokenSet, isDetailIntent, isCompareIntent, isSelectionIntent, extractSelectionIndex } = require("./scheme");

function isLikelyGibberish(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return false;
  const lettersOnly = t.replace(/[^a-z]/g, "");
  if (!lettersOnly) return false;
  const words = t.split(/\s+/).filter(Boolean);
  const veryLongSingle = words.length === 1 && words[0].length >= 10;
  const vowelCount = (lettersOnly.match(/[aeiou]/g) || []).length;
  const vowelRatio = vowelCount / lettersOnly.length;
  const hasBigConsonantRun = /[bcdfghjklmnpqrstvwxyz]{6,}/.test(lettersOnly);
  const repeatedGarble = /(.)\1{4,}/.test(lettersOnly);
  return (veryLongSingle && (vowelRatio < 0.2 || hasBigConsonantRun)) || repeatedGarble;
}

async function hasSchemeDomainSignal(text, profile = null, { geographyService = null } = {}) {
  const q = String(text || "").toLowerCase();
  const keywords = [
    "scheme", "schemes", "yojana", "scholarship", "pension", "benefit", "subsidy", "loan", "apply",
    "application", "eligibility", "document", "office", "helpline", "government support", "sarkari", "madad",
    "yojnaa", "yojna", "kisan", "farmer", "student", "business", "msme", "startup", "upsc", "coaching",
    "scheme ke bare", "योजना", "छात्रवृत्ति", "पेंशन", "लाभ", "पात्रता", "दस्तावेज", "माहिती", "शिष्यवृत्ती", "पेन्शन", "कागदपत्र",
  ];
  if (keywords.some((k) => q.includes(k))) return true;
  if (profile && hasProfileSignal(profile)) return true;
  if (geographyService) {
    try {
      const geo = await geographyService.extractFromText(q);
      if (geo?.state || geo?.district || geo?.city) return true;
    } catch (_) {
      // ignore and fall through
    }
  }
  return false;
}

function isDisengageText(text) {
  const raw = String(text || "").trim().toLowerCase();
  if (!raw) return false;
  if (/\b(no income|zero income|without income|no earning|no earnings|no money|no cash|income nil)\b/.test(raw)) return false;
  return /\b(nope|nah|not now|later|stop|cancel|leave it|drop it|skip|nothing|i don't want|i dont want|don't want|dont want|not interested|no thanks|bye)\b/.test(raw);
}

function isOutOfScopeText(text) {
  const q = String(text || "").toLowerCase();
  if (!q.trim()) return false;
  if (isDisengageText(q)) return false;

  const outScopeHints = [
    "joke", "funny", "song", "lyrics", "movie", "cricket score", "ipl", "bitcoin", "stock", "coding", "python",
    "javascript", "relationship", "girlfriend", "boyfriend", "weather", "news", "time now", "translate this",
  ];
  return outScopeHints.some((k) => q.includes(k));
}

function discoverySignal(question, profile, session) {
  const q = normalizeText(question);
  const tokens = q.split(" ").filter(Boolean);
  const hasProfile = !!(
    profile.state ||
    profile.district ||
    profile.city ||
    profile.age != null ||
    profile.profession ||
    profile.category ||
    profile.incomeAnnual ||
    profile.landAcres
  );
  const schemeIntent = /(scheme|scholarship|pension|benefit|loan|subsidy|support|help|apply|eligibility|yojana)/i.test(question);
  const actionIntent = /(find|need|want|show|give|suggest|recommend|tell)/i.test(question);
  const hasNumbers = /\d/.test(question);
  const referencesSelected = !!session.selectedScheme && tokenSet(question).size > 0 && tokenSet(session.selectedScheme.name).size > 0;

  let score = 0;
  if (hasProfile) score += 2;
  if (schemeIntent) score += 3;
  if (actionIntent) score += 1;
  if (hasNumbers) score += 1;
  if (tokens.length >= 6) score += 1;
  if (referencesSelected) score += 1;
  return score;
}

function inferSupportType(question) {
  const q = String(question || "").toLowerCase();
  if (/(upsc|cse|exam|coaching|preparation)/.test(q)) return "exam_support";
  if (/(scholarship|education|student)/.test(q)) return "scholarship";
  if (/(pension|senior|old age)/.test(q)) return "pension";
  if (/(farmer|agri|kisan|crop)/.test(q)) return "farmer";
  if (/(business|shop|startup|loan|msme|entrepreneur)/.test(q)) return "business";
  if (/(health|medical|hospital|insurance)/.test(q)) return "health";
  return null;
}

function classifyIntent(question, session) {
  const text = normalizeText(question);
  const tokens = text.split(" ").filter(Boolean);
  const rawTrim = String(question || "").trim();
  if (!/[a-z0-9]/i.test(rawTrim) && rawTrim.length > 0) return { intent: "smalltalk_noise", confidence: 0.99 };
  if (isLikelyGibberish(rawTrim)) return { intent: "nonsense_noise", confidence: 0.99 };

  const noiseWords = new Set(["lol", "haha", "hahaha", "ok", "okay", "hmm", "hmmm", "huh", "yo", "hi", "hello", "hey", "thanks", "thank", "nice", "great", "cool", "h", "k"]);
  const hasPendingQuestion = !!session.pendingQuestion;
  const hasProfileLikeSignal =
    /\b(sc|st|obc|ews|minority|general|farmer|student|worker|entrepreneur|income|salary|age|years|acre|hectare|district|city|state)\b/i.test(
      question
    ) ||
    /\d/.test(question);
  const isNoiseText =
    !hasPendingQuestion &&
    !hasProfileLikeSignal &&
    tokens.length > 0 &&
    tokens.length <= 3 &&
    tokens.every((t) => noiseWords.has(t) || /^ha+$/.test(t) || /^he+$/.test(t));
  if (isNoiseText) return { intent: "smalltalk_noise", confidence: 0.98 };

  const ackWords = new Set(["yes", "no", "yep", "nope", "maybe", "sure", "ok", "okay", "done"]);
  if (tokens.length > 0 && tokens.length <= 2 && tokens.every((t) => ackWords.has(t))) {
    return { intent: "unclear_ack", confidence: 0.9 };
  }

  const hasStateComplaint = /(i asked|why|wrong|instead|you gave|you are giving|other state|another state|not.*state)/i.test(question) && /(state)/i.test(question);
  if (hasStateComplaint) return { intent: "complaint_correction", confidence: 0.95 };
  if (isOutOfScopeText(question)) return { intent: "out_of_scope", confidence: 0.9 };

  if (isCompareIntent(question)) return { intent: "compare_request", confidence: 0.9 };
  if (extractSelectionIndex(question) != null) return { intent: "selection", confidence: 0.9 };
  if (isSelectionIntent(question)) return { intent: "selection", confidence: 0.85 };
  if (isDetailIntent(question)) return { intent: "detail_request", confidence: 0.8 };

  const pendingQuestion = session.pendingQuestion || null;
  if (pendingQuestion && text.split(" ").length <= 8) return { intent: "clarification_answer", confidence: 0.7 };

  return { intent: "new_discovery", confidence: 0.7 };
}

async function classifyIntentSmart(question, session, { classifyIntentModel, runWithRetry }) {
  try {
    const modelResult = await runWithRetry(
      () =>
        classifyIntentModel(question, {
          pendingQuestion: session.pendingQuestion || null,
          hasSelectedScheme: !!session.selectedScheme,
          lastAssistantAction: session.lastAssistantAction || null,
        }),
      { timeoutMs: 6000, retries: 1, label: "intent" }
    );

    const validIntents = new Set([
      "smalltalk_noise", "nonsense_noise", "unclear_ack", "complaint_correction", "compare_request",
      "selection", "detail_request", "clarification_answer", "out_of_scope", "new_discovery",
    ]);

    if (modelResult && validIntents.has(modelResult.intent)) {
      const confidence = Number(modelResult.confidence);
      return {
        intent: modelResult.intent,
        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.75,
        source: "model",
      };
    }
  } catch (_) {
    // fall through to rules
  }

  const fallback = classifyIntent(question, session);
  return { ...fallback, source: "rule" };
}

module.exports = {
  classifyIntent,
  classifyIntentSmart,
  hasSchemeDomainSignal,
  discoverySignal,
  inferSupportType,
};
