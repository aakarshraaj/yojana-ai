require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { randomUUID, createHash } = require("crypto");
const { generateEmbedding, generateChatResponse, translateText } = require("./lib/openai");
const { searchSchemes } = require("./lib/supabase");

const requiredEnv = ["OPENAI_API_KEY", "SUPABASE_URL", "SUPABASE_KEY"];
const missingEnv = requiredEnv.filter((k) => !process.env[k]);
if (missingEnv.length) {
  console.error("Missing required env vars:", missingEnv.join(", "));
  process.exit(1);
}

const STATES = [
  "andhra pradesh",
  "arunachal pradesh",
  "assam",
  "bihar",
  "chhattisgarh",
  "goa",
  "gujarat",
  "haryana",
  "himachal pradesh",
  "jharkhand",
  "karnataka",
  "kerala",
  "madhya pradesh",
  "maharashtra",
  "manipur",
  "meghalaya",
  "mizoram",
  "nagaland",
  "odisha",
  "punjab",
  "rajasthan",
  "sikkim",
  "tamil nadu",
  "telangana",
  "tripura",
  "uttar pradesh",
  "uttarakhand",
  "west bengal",
  "delhi",
  "jammu and kashmir",
  "ladakh",
  "chandigarh",
  "puducherry",
];

const PROFESSION_KEYWORDS = {
  farmer: ["farmer", "agriculture", "kisan", "cultivator"],
  student: ["student", "school", "college"],
  worker: ["worker", "labour", "labor", "daily wage"],
  entrepreneur: ["business", "entrepreneur", "startup", "self employed", "self-employed"],
};

const CATEGORY_KEYWORDS = {
  sc: ["sc", "scheduled caste"],
  st: ["st", "scheduled tribe", "tribal"],
  obc: ["obc", "backward class", "other backward class"],
  ews: ["ews", "economically weaker"],
  minority: ["minority"],
  general: ["general category", "open category"],
};

const SESSION_TTL_MS = 1000 * 60 * 60 * 24;
const sessionMemory = new Map();

const app = express();
app.set("trust proxy", true);
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.json({ status: "yojana-ai running" });
});

function cleanupSessions() {
  const now = Date.now();
  for (const [sessionId, data] of sessionMemory.entries()) {
    if (now - data.updatedAt > SESSION_TTL_MS) sessionMemory.delete(sessionId);
  }
}

function fallbackSessionId(req) {
  const ip = req.headers["x-forwarded-for"] || req.ip || "unknown-ip";
  const ua = req.headers["user-agent"] || "unknown-ua";
  return createHash("sha256").update(`${ip}|${ua}`).digest("hex").slice(0, 24);
}

function getSession(sessionIdInput, req) {
  const sessionId =
    typeof sessionIdInput === "string" && sessionIdInput.trim()
      ? sessionIdInput.trim()
      : fallbackSessionId(req) || randomUUID();
  const existing = sessionMemory.get(sessionId) || { profile: {}, updatedAt: Date.now() };
  existing.updatedAt = Date.now();
  sessionMemory.set(sessionId, existing);
  return { sessionId, session: existing };
}

function toNumber(value) {
  const n = Number(String(value || "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function unitMultiplier(unit) {
  const u = (unit || "").toLowerCase();
  if (["lakh", "lakhs", "lac", "lacs"].includes(u)) return 100000;
  if (["crore", "crores"].includes(u)) return 10000000;
  if (["k", "thousand"].includes(u)) return 1000;
  return 1;
}

function extractState(text) {
  const lower = text.toLowerCase();
  return STATES.find((s) => lower.includes(s)) || null;
}

function extractByKeywords(text, dict) {
  const lower = text.toLowerCase();
  for (const [key, keywords] of Object.entries(dict)) {
    if (keywords.some((kw) => lower.includes(kw))) return key;
  }
  return null;
}

function extractIncome(text) {
  const patterns = [
    /(?:income|salary|earning|annual income)[^\d]{0,20}(?:rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)(?:\s*(lakh|lakhs|lac|lacs|crore|crores|k|thousand))?/i,
    /(?:rs\.?|inr)\s*([\d,]+(?:\.\d+)?)(?:\s*(lakh|lakhs|lac|lacs|crore|crores|k|thousand))?/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (!m) continue;
    const base = toNumber(m[1]);
    if (base == null) continue;
    return Math.round(base * unitMultiplier(m[2]));
  }
  return null;
}

function extractLandAcres(text) {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(acre|acres|hectare|hectares|ha)\b/i);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  const unit = m[2].toLowerCase();
  if (unit === "hectare" || unit === "hectares" || unit === "ha") return Number((value * 2.47105).toFixed(2));
  return value;
}

function extractProfile(question) {
  return {
    state: extractState(question),
    profession: extractByKeywords(question, PROFESSION_KEYWORDS),
    category: extractByKeywords(question, CATEGORY_KEYWORDS),
    incomeAnnual: extractIncome(question),
    landAcres: extractLandAcres(question),
  };
}

function mergeProfile(oldProfile, newProfile) {
  return {
    state: newProfile.state || oldProfile.state || null,
    profession: newProfile.profession || oldProfile.profession || null,
    category: newProfile.category || oldProfile.category || null,
    incomeAnnual: newProfile.incomeAnnual != null ? newProfile.incomeAnnual : oldProfile.incomeAnnual ?? null,
    landAcres: newProfile.landAcres != null ? newProfile.landAcres : oldProfile.landAcres ?? null,
  };
}

function profileText(profile) {
  const fields = [];
  if (profile.state) fields.push(`State: ${profile.state}`);
  if (profile.profession) fields.push(`Profession: ${profile.profession}`);
  if (profile.category) fields.push(`Category: ${profile.category}`);
  if (profile.incomeAnnual != null) fields.push(`Annual income INR: ${profile.incomeAnnual}`);
  if (profile.landAcres != null) fields.push(`Land acres: ${profile.landAcres}`);
  return fields.join(" | ") || "No profile captured";
}

function getNextQuestion(profile) {
  if (!profile.state) return "Which state do you live in?";
  if (!profile.profession) return "What is your profession (farmer, student, worker, entrepreneur)?";
  if (profile.profession === "farmer" && profile.landAcres == null) return "How many acres of land do you own?";
  if (profile.incomeAnnual == null) return "What is your annual household income in INR?";
  if (!profile.category) return "What is your social category (SC, ST, OBC, EWS, minority, or general)?";
  return null;
}

function classifyIntent(question, session) {
  const text = normalizeText(question);
  const tokens = text.split(" ").filter(Boolean);
  const noiseWords = new Set([
    "lol",
    "haha",
    "hahaha",
    "ok",
    "okay",
    "hmm",
    "hmmm",
    "huh",
    "yo",
    "hi",
    "hello",
    "hey",
    "thanks",
    "thank",
    "nice",
    "great",
    "cool",
    "h",
    "k",
  ]);
  const isNoiseText =
    tokens.length > 0 &&
    tokens.length <= 3 &&
    tokens.every((t) => noiseWords.has(t) || /^ha+$/.test(t) || /^he+$/.test(t));
  if (isNoiseText) return { intent: "smalltalk_noise", confidence: 0.98 };

  const hasStateComplaint =
    /(i asked|why|wrong|instead|you gave|you are giving|other state|another state|not.*state)/i.test(question) &&
    /(state|arunachal|maharashtra|jharkhand|rajasthan|gujarat|karnataka|punjab|haryana)/i.test(question);
  if (hasStateComplaint) return { intent: "complaint_correction", confidence: 0.95 };

  if (isCompareIntent(question)) return { intent: "compare_request", confidence: 0.9 };
  if (isSelectionIntent(question)) return { intent: "selection", confidence: 0.85 };
  if (isDetailIntent(question)) return { intent: "detail_request", confidence: 0.8 };

  const pendingQuestion = session.pendingQuestion || null;
  if (pendingQuestion && text.split(" ").length <= 8) {
    return { intent: "clarification_answer", confidence: 0.7 };
  }

  return { intent: "new_discovery", confidence: 0.7 };
}

function isCentralScheme(raw) {
  return /(pradhan mantri|pm-|government of india|ministry of|national scheme|centrally sponsored|all india|central government)/i.test(
    raw
  );
}

function extractMentionedStates(raw) {
  const lower = raw.toLowerCase();
  return STATES.filter((s) => lower.includes(s));
}

function scoreMatch(match, profile) {
  const raw = JSON.stringify(match.raw_json || "");
  const lower = raw.toLowerCase();
  const mentionedStates = extractMentionedStates(raw);
  const central = isCentralScheme(raw);
  let ruleScore = 0;
  let hardReject = false;

  if (profile.state) {
    if (lower.includes(profile.state)) ruleScore += 20;
    if (!central && mentionedStates.length > 0 && !mentionedStates.includes(profile.state)) hardReject = true;
  }

  if (profile.profession && PROFESSION_KEYWORDS[profile.profession]) {
    if (PROFESSION_KEYWORDS[profile.profession].some((k) => lower.includes(k))) ruleScore += 10;
  }

  const semantic = Number(match.similarity || 0) * 100;
  const finalScore = semantic + ruleScore;
  const eligibilityProbability = Math.max(5, Math.min(99, Math.round(finalScore)));

  return {
    ...match,
    semanticScore: semantic,
    ruleScore,
    finalScore,
    hardReject,
    eligibilityProbability,
  };
}

function applyStateGuardrails(matches, profile) {
  const normalized = normalizeMatches(matches);
  if (!profile.state) {
    return { matches: normalized, droppedCount: 0, mismatchDetected: false };
  }

  let droppedCount = 0;
  const filtered = normalized.filter((m) => {
    const raw = JSON.stringify(m.raw_json || "");
    const mentionedStates = extractMentionedStates(raw);
    if (mentionedStates.length === 0) return true;
    if (mentionedStates.includes(profile.state)) return true;
    if (isCentralScheme(raw)) return true;
    droppedCount += 1;
    return false;
  });

  return {
    matches: filtered.length > 0 ? filtered : normalized,
    droppedCount,
    mismatchDetected: droppedCount > 0,
  };
}

function normalizeMatches(matches) {
  return (matches || []).map((m) => ({
    ...m,
    name: m.name || m.scheme_name || m.title || m.slug || "Unnamed scheme",
    similarity: Number(m.similarity || 0),
  }));
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(text) {
  return new Set(
    normalizeText(text)
      .split(" ")
      .filter((t) => t.length > 2 && !["scheme", "for", "with", "and", "the", "of", "to", "in"].includes(t))
  );
}

function isDetailIntent(question) {
  return /(more|detail|about|apply|application|process|how to|how do|documents|document|eligibility|link|website|form|office|address|contact|helpline)/i.test(
    question
  );
}

function isCompareIntent(question) {
  return /(compare|difference|vs|versus|better|best among|which is better)/i.test(question);
}

function isSelectionIntent(question) {
  return /(select|choose|pick|go with|finalize|this one|that one|first one|second one)/i.test(question);
}

function choiceSummary(matches, limit = 4) {
  const items = normalizeMatches(matches).slice(0, limit);
  if (!items.length) return "No recent schemes to choose from.";
  return items.map((m, i) => `${i + 1}. ${m.name}`).join("\n");
}

function findCompareSchemes(question, candidateMatches) {
  const qTokens = tokenSet(question);
  const matched = [];
  for (const m of normalizeMatches(candidateMatches)) {
    const nameTokens = tokenSet(m.name);
    const overlap = [...nameTokens].filter((t) => qTokens.has(t)).length;
    if (overlap >= 2 || normalizeText(question).includes(normalizeText(m.name))) {
      matched.push(m);
    }
  }
  return matched.slice(0, 2);
}

function findFocusedScheme(question, candidateMatches) {
  const qNorm = normalizeText(question);
  const qTokens = tokenSet(question);
  const detailIntent = isDetailIntent(question);

  let best = null;
  let bestScore = 0;

  for (const match of normalizeMatches(candidateMatches)) {
    const nameNorm = normalizeText(match.name);
    const nameTokens = tokenSet(match.name);
    const overlap = [...nameTokens].filter((t) => qTokens.has(t)).length;
    const overlapRatio = nameTokens.size ? overlap / nameTokens.size : 0;

    let score = 0;
    if (nameNorm && qNorm.includes(nameNorm)) score += 100;
    score += overlap * 10 + overlapRatio * 20;
    if (detailIntent) score += 5;

    if (score > bestScore) {
      best = match;
      bestScore = score;
    }
  }

  if (!best) return null;
  if (bestScore >= 20) return best;
  if (detailIntent && bestScore >= 10) return best;
  return null;
}

function extractLinks(rawJson) {
  const text = JSON.stringify(rawJson || "");
  const links = text.match(/https?:\/\/[^\s"\\]+/g) || [];
  return [...new Set(links)].slice(0, 5);
}

function buildFocusedContext(match) {
  const raw = match.raw_json?.data?.en || {};
  let description = raw.schemeContent?.briefDescription || raw.schemeContent?.schemeContent || "";
  let eligibility = raw.eligibilityCriteria?.eligibilityDescription_md || raw.eligibilityCriteria?.description || "";
  let benefits = raw.schemeBenefits?.benefits || raw.schemeBenefits?.description || "";
  let documents = raw.documentsRequired || raw.requiredDocuments || raw.eligibilityCriteria?.documentsRequired || "";
  let applyOnline = raw.howToApply?.onlineApplication || raw.howToApply?.online || raw.applicationProcess?.online || "";
  let applyOffline = raw.howToApply?.offlineApplication || raw.howToApply?.offline || raw.applicationProcess?.offline || "";
  let contact = raw.contactDetails || raw.contact || raw.helpline || "";

  if (typeof description !== "string") description = JSON.stringify(description);
  if (typeof eligibility !== "string") eligibility = JSON.stringify(eligibility);
  if (typeof benefits !== "string") benefits = JSON.stringify(benefits);
  if (typeof documents !== "string") documents = JSON.stringify(documents);
  if (typeof applyOnline !== "string") applyOnline = JSON.stringify(applyOnline);
  if (typeof applyOffline !== "string") applyOffline = JSON.stringify(applyOffline);
  if (typeof contact !== "string") contact = JSON.stringify(contact);

  const links = extractLinks(raw).join("\n") || "Not found";

  return `Focused Scheme Detail
Name: ${match.name}
Eligibility Probability: ${match.eligibilityProbability || "N/A"}%

Description:
${description.slice(0, 1000)}

Eligibility:
${eligibility.slice(0, 1000)}

Benefits:
${benefits.slice(0, 800)}

Documents Required:
${documents.slice(0, 800) || "Not found"}

How To Apply Online:
${applyOnline.slice(0, 800) || "Not found"}

How To Apply Offline:
${applyOffline.slice(0, 800) || "Not found"}

Contact/Helpline:
${contact.slice(0, 500) || "Not found"}

Useful Links:
${links}
`;
}

function buildCompareContext(a, b) {
  return `Compare these two schemes only.

Scheme A:
${buildFocusedContext(a)}

Scheme B:
${buildFocusedContext(b)}
`;
}

function buildDeterministicList(matches, profileState = null) {
  const lines = [];
  if (profileState) lines.push(`Here are corrected options for ${profileState}:`);
  else lines.push("Here are relevant schemes:");
  lines.push("");

  matches.slice(0, 4).forEach((m, i) => {
    lines.push(`${i + 1}. ${m.name} (Eligibility Probability: ${m.eligibilityProbability}%)`);
  });

  return lines.join("\n");
}

function validateGeneratedAnswer(answer, mode, intent) {
  const text = String(answer || "").toLowerCase();
  if (intent === "complaint_correction") {
    return /(you are right|you’re right|you are correct|sorry|apologize)/.test(text);
  }
  if (mode === "focused") {
    return !/(1\.\s|2\.\s|here are some relevant schemes)/.test(text);
  }
  return true;
}

async function buildSmalltalkClarifier(session, profile, toUserLanguage) {
  const hasProfile = !!(profile.state || profile.profession || profile.category || profile.incomeAnnual || profile.landAcres);
  const selectedScheme = session.selectedScheme?.name || null;
  let base;
  if (selectedScheme) {
    base = `If you want, I can continue with ${selectedScheme}. Ask for documents, eligibility, apply link, office address, or contact details.`;
  } else if (hasProfile) {
    base = "Tell me what you want next: find new schemes, compare two schemes, or detailed help for one scheme.";
  } else {
    base =
      "I can help with schemes. Share your state and what support you need (scholarship, pension, farmer, business, health).";
  }
  return toUserLanguage(base);
}

function rankMatches(matches, profile) {
  const scored = normalizeMatches(matches).map((m) => scoreMatch(m, profile));
  const keep = scored.filter((m) => !m.hardReject);
  const base = keep.length > 0 ? keep : scored;
  return base.sort((a, b) => b.finalScore - a.finalScore).slice(0, 5);
}

function buildContext(matches) {
  return matches
    .map((m, i) => {
      const raw = m.raw_json?.data?.en || {};
      let description = raw.schemeContent?.briefDescription || raw.schemeContent?.schemeContent || "";
      let eligibility = raw.eligibilityCriteria?.eligibilityDescription_md || raw.eligibilityCriteria?.description || "";
      let benefits = raw.schemeBenefits?.benefits || raw.schemeBenefits?.description || "";

      if (typeof description !== "string") description = JSON.stringify(description);
      if (typeof eligibility !== "string") eligibility = JSON.stringify(eligibility);
      if (typeof benefits !== "string") benefits = JSON.stringify(benefits);

      return `\nScheme ${i + 1}\nName: ${m.name}\nSimilarity: ${m.similarity.toFixed(3)}\nEligibility Probability: ${m.eligibilityProbability}%\n\nDescription:\n${description.slice(0, 700)}\n\nEligibility:\n${eligibility.slice(0, 500)}\n\nBenefits:\n${benefits.slice(0, 400)}\n`;
    })
    .join("\n---------------------------------\n");
}

async function translateToEnglish(text) {
  return translateText(text, "English");
}

async function translateToHindi(text) {
  return translateText(text, "Hindi");
}

app.post("/chat", async (req, res) => {
  try {
    cleanupSessions();
    const { question, language = "en", sessionId: sessionIdInput } = req.body;
    const normalizedLanguage = String(language || "en").toLowerCase();

    if (!question || question.trim().length === 0) {
      return res.status(400).json({ error: "Question is required" });
    }

    const toUserLanguage = async (text) => {
      if (!text) return text;
      if (normalizedLanguage === "hi") return translateToHindi(text);
      return text;
    };

    let canonicalQuestion = question;
    if (normalizedLanguage === "hi") {
      canonicalQuestion = await translateToEnglish(question);
    }

    const { sessionId, session } = getSession(sessionIdInput, req);
    const mergedProfile = mergeProfile(session.profile || {}, extractProfile(canonicalQuestion));
    session.profile = mergedProfile;
    session.updatedAt = Date.now();
    const previousMatches = Array.isArray(session.lastMatches) ? session.lastMatches : [];
    const previousSelectedScheme = session.selectedScheme || null;
    const intentMeta = classifyIntent(canonicalQuestion, session);
    const intent = intentMeta.intent;

    console.log(
      JSON.stringify({
        tag: "chat_turn",
        sessionId,
        userQuestion: question,
        canonicalQuestion,
        intent,
        intentConfidence: intentMeta.confidence,
        profileState: mergedProfile.state || null,
      })
    );

    if (intent === "smalltalk_noise") {
      session.lastAssistantAction = "clarify";
      session.pendingQuestion = "user intent clarification";
      return res.json({
        sessionId,
        memory: mergedProfile,
        interview: { nextQuestion: null },
        answer: await buildSmalltalkClarifier(session, mergedProfile, toUserLanguage),
        matches: [],
      });
    }

    if (intent === "complaint_correction") {
      session.selectedScheme = null;
      const correctionQuery = mergedProfile.state
        ? `${canonicalQuestion}\n\nStrictly for state: ${mergedProfile.state}`
        : canonicalQuestion;
      const embedding = await generateEmbedding(correctionQuery);
      const rawMatches = await searchSchemes(embedding);
      const guarded = applyStateGuardrails(rawMatches, mergedProfile);
      const matches = rankMatches(guarded.matches, mergedProfile);
      session.lastMatches = matches.slice(0, 10);
      session.lastAssistantAction = "complaint_correction";
      session.lastError = guarded.mismatchDetected ? "state_mismatch_detected" : null;
      session.pendingQuestion = null;

      let answer;
      if (!matches.length) {
        answer = `You are right. The previous response mixed the wrong state. I could not find strong ${mergedProfile.state || "state"}-specific matches right now, but I can retry with more profile details.`;
      } else {
        const context = buildContext(matches);
        const modelAnswer = await generateChatResponse(
          canonicalQuestion,
          context,
          profileText(mergedProfile),
          null,
          "list"
        );
        const acknowledged = `You are right, that was incorrect. I should only show ${mergedProfile.state || "your state"} (or central) schemes.\n\n`;
        answer = validateGeneratedAnswer(modelAnswer, "list", "complaint_correction")
          ? acknowledged + modelAnswer
          : `${acknowledged}${buildDeterministicList(matches, mergedProfile.state)}`;
      }

      return res.json({
        sessionId,
        memory: mergedProfile,
        interview: { nextQuestion: null },
        answer: await toUserLanguage(answer),
        quality: { stateMismatchDetected: guarded.mismatchDetected, droppedForState: guarded.droppedCount },
        matches: matches.map((m) => ({
          slug: m.slug || null,
          name: m.name,
          similarity: m.similarity,
          semanticScore: Number(m.semanticScore.toFixed(2)),
          ruleScore: m.ruleScore,
          finalScore: Number(m.finalScore.toFixed(2)),
          eligibilityProbability: m.eligibilityProbability,
        })),
      });
    }

    if (intent === "compare_request") {
      const comparePair = findCompareSchemes(canonicalQuestion, previousMatches);
      if (comparePair.length === 2) {
        const a = scoreMatch(comparePair[0], mergedProfile);
        const b = scoreMatch(comparePair[1], mergedProfile);
        const context = buildCompareContext(a, b);
        const answer = await generateChatResponse(canonicalQuestion, context, profileText(mergedProfile), null, "compare");
        const localizedAnswer = await toUserLanguage(answer);
        session.lastAssistantAction = "compare";
        session.pendingQuestion = null;
        return res.json({
          sessionId,
          memory: mergedProfile,
          interview: { nextQuestion: null },
          answer: localizedAnswer,
          matches: [a, b].map((m) => ({
            slug: m.slug || null,
            name: m.name,
            similarity: Number(m.similarity || 0),
            semanticScore: Number(m.semanticScore.toFixed(2)),
            ruleScore: m.ruleScore,
            finalScore: Number(m.finalScore.toFixed(2)),
            eligibilityProbability: m.eligibilityProbability,
          })),
        });
      }
      session.lastAssistantAction = "clarify";
      session.pendingQuestion = "which two schemes to compare";
      return res.json({
        sessionId,
        memory: mergedProfile,
        interview: { nextQuestion: null },
        answer: await toUserLanguage(
          `Tell me exactly which two schemes you want to compare.\n\nRecent options:\n${choiceSummary(previousMatches)}`
        ),
        matches: normalizeMatches(previousMatches).slice(0, 4).map((m) => ({
          slug: m.slug || null,
          name: m.name,
          similarity: Number(m.similarity || 0),
        })),
      });
    }

    if (intent === "selection" && previousMatches.length) {
      const selected =
        findFocusedScheme(canonicalQuestion, previousMatches) ||
        normalizeMatches(previousMatches)[0] ||
        null;
      if (selected) {
        const ranked = scoreMatch(selected, mergedProfile);
        session.selectedScheme = ranked;
        const context = buildFocusedContext(ranked);
        const answer = await generateChatResponse(canonicalQuestion, context, profileText(mergedProfile), null, "focused");
        const finalAnswer = validateGeneratedAnswer(answer, "focused", intent)
          ? answer
          : buildFocusedContext(ranked);
        const localizedAnswer = await toUserLanguage(finalAnswer);
        session.lastAssistantAction = "focused";
        session.pendingQuestion = null;
        return res.json({
          sessionId,
          memory: mergedProfile,
          interview: { nextQuestion: null },
          answer: localizedAnswer,
          selectedScheme: ranked.name,
          matches: [
            {
              slug: ranked.slug || null,
              name: ranked.name,
              similarity: Number(ranked.similarity || 0),
              semanticScore: Number(ranked.semanticScore.toFixed(2)),
              ruleScore: ranked.ruleScore,
              finalScore: Number(ranked.finalScore.toFixed(2)),
              eligibilityProbability: ranked.eligibilityProbability,
            },
          ],
        });
      }
    }

    const focusedFromHistory = findFocusedScheme(canonicalQuestion, previousMatches);
    const stickyFocusedScheme =
      focusedFromHistory ||
      (intent === "detail_request" && previousSelectedScheme ? previousSelectedScheme : null);

    if (intent === "detail_request" && stickyFocusedScheme) {
      const focusedRanked = scoreMatch(stickyFocusedScheme, mergedProfile);
      session.selectedScheme = focusedRanked;
      const focusedContext = buildFocusedContext(focusedRanked);
      const answer = await generateChatResponse(
        canonicalQuestion,
        focusedContext,
        profileText(mergedProfile),
        null,
        "focused"
      );
      const finalAnswer = validateGeneratedAnswer(answer, "focused", intent)
        ? answer
        : `Here are details for ${focusedRanked.name}:\n\n${focusedContext}`;
      session.lastAssistantAction = "focused";
      session.pendingQuestion = null;
      return res.json({
        sessionId,
        memory: mergedProfile,
        interview: { nextQuestion: null },
        answer: await toUserLanguage(finalAnswer),
        selectedScheme: focusedRanked.name,
        matches: [
          {
            slug: focusedRanked.slug || null,
            name: focusedRanked.name,
            similarity: Number(focusedRanked.similarity || 0),
            semanticScore: Number(focusedRanked.semanticScore.toFixed(2)),
            ruleScore: focusedRanked.ruleScore,
            finalScore: Number(focusedRanked.finalScore.toFixed(2)),
            eligibilityProbability: focusedRanked.eligibilityProbability,
          },
        ],
      });
    }

    const query = `${canonicalQuestion}\n\nKnown profile: ${profileText(mergedProfile)}`;
    const embedding = await generateEmbedding(query);
    const rawMatches = await searchSchemes(embedding);
    const guarded = applyStateGuardrails(rawMatches, mergedProfile);
    let matches = rankMatches(guarded.matches, mergedProfile);
    session.lastMatches = matches.slice(0, 10);
    session.lastError = guarded.mismatchDetected ? "state_mismatch_detected" : null;

    const nextQuestion = getNextQuestion(mergedProfile);
    const localizedNextQuestion = nextQuestion ? await toUserLanguage(nextQuestion) : null;

    if (!matches.length) {
      if (intent === "detail_request" && previousMatches.length) {
        session.lastAssistantAction = "clarify";
        session.pendingQuestion = "which scheme do you mean";
        return res.json({
          sessionId,
          memory: mergedProfile,
          interview: { nextQuestion: null },
          answer: await toUserLanguage(
            `I can help with that, but please tell me which scheme you mean.\n\nRecent options:\n${choiceSummary(
              previousMatches
            )}`
          ),
          matches: normalizeMatches(previousMatches).slice(0, 4).map((m) => ({
            slug: m.slug || null,
            name: m.name,
            similarity: Number(m.similarity || 0),
          })),
        });
      }
      session.lastAssistantAction = "clarify";
      session.pendingQuestion = nextQuestion || null;
      return res.json({
        sessionId,
        memory: mergedProfile,
        interview: { nextQuestion: localizedNextQuestion },
        answer: await toUserLanguage(
          nextQuestion || "I could not find relevant schemes right now. Please try another wording or share more details."
        ),
        matches: [],
      });
    }

    const focusedFromCurrent = findFocusedScheme(canonicalQuestion, matches);
    if (intent === "detail_request" && !focusedFromCurrent && !previousSelectedScheme) {
      session.lastAssistantAction = "clarify";
      session.pendingQuestion = "scheme name for details";
      return res.json({
        sessionId,
        memory: mergedProfile,
        interview: { nextQuestion: null },
        answer: await toUserLanguage(
          `Please tell me the exact scheme name you want details for.\n\nTop options:\n${choiceSummary(matches)}`
        ),
        matches: matches.slice(0, 4).map((m) => ({
          slug: m.slug || null,
          name: m.name,
          similarity: m.similarity,
          semanticScore: Number(m.semanticScore.toFixed(2)),
          ruleScore: m.ruleScore,
          finalScore: Number(m.finalScore.toFixed(2)),
          eligibilityProbability: m.eligibilityProbability,
        })),
      });
    }

    if (intent === "detail_request" && focusedFromCurrent) {
      session.selectedScheme = focusedFromCurrent;
      const focusedContext = buildFocusedContext(focusedFromCurrent);
      const answer = await generateChatResponse(
        canonicalQuestion,
        focusedContext,
        profileText(mergedProfile),
        null,
        "focused"
      );
      const finalAnswer = validateGeneratedAnswer(answer, "focused", intent)
        ? answer
        : `Here are details for ${focusedFromCurrent.name}:\n\n${focusedContext}`;
      session.lastAssistantAction = "focused";
      session.pendingQuestion = null;
      return res.json({
        sessionId,
        memory: mergedProfile,
        interview: { nextQuestion: null },
        answer: await toUserLanguage(finalAnswer),
        selectedScheme: focusedFromCurrent.name,
        matches: matches.map((m) => ({
          slug: m.slug || null,
          name: m.name,
          similarity: m.similarity,
          semanticScore: Number(m.semanticScore.toFixed(2)),
          ruleScore: m.ruleScore,
          finalScore: Number(m.finalScore.toFixed(2)),
          eligibilityProbability: m.eligibilityProbability,
        })),
      });
    }

    const context = buildContext(matches);
    const answer = await generateChatResponse(
      canonicalQuestion,
      context,
      profileText(mergedProfile),
      nextQuestion,
      "list"
    );
    const listAnswer = validateGeneratedAnswer(answer, "list", intent)
      ? answer
      : buildDeterministicList(matches, mergedProfile.state);
    const localizedAnswer = await toUserLanguage(listAnswer);
    session.lastAssistantAction = "list";
    session.pendingQuestion = nextQuestion || null;

    return res.json({
      sessionId,
      memory: mergedProfile,
      interview: { nextQuestion: localizedNextQuestion },
      answer: localizedAnswer,
      quality: { stateMismatchDetected: guarded.mismatchDetected, droppedForState: guarded.droppedCount },
      matches: matches.map((m) => ({
        slug: m.slug || null,
        name: m.name,
        similarity: m.similarity,
        semanticScore: Number(m.semanticScore.toFixed(2)),
        ruleScore: m.ruleScore,
        finalScore: Number(m.finalScore.toFixed(2)),
        eligibilityProbability: m.eligibilityProbability,
      })),
    });
  } catch (err) {
    console.error("FULL ERROR DUMP:");
    console.error(err?.stack || err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Yojana AI running on port ${PORT}`);
  console.log("Supabase host:", process.env.SUPABASE_URL);
});
