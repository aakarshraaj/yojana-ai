require("dotenv").config();
const express = require("express");
const { randomUUID } = require("crypto");
const { generateEmbedding, generateChatResponse } = require("./lib/openai");
const { searchSchemes } = require("./lib/supabase");

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
  farmer: ["farmer", "agriculture", "cultivator", "kisan"],
  student: ["student", "studying", "college", "school"],
  woman: ["woman", "women", "female", "girl"],
  entrepreneur: ["entrepreneur", "business", "startup", "self employed", "self-employed"],
  worker: ["worker", "labour", "labor", "daily wage"],
  senior_citizen: ["senior citizen", "old age", "elderly", "retired"],
  disabled: ["disabled", "disability", "divyang"],
};

const CASTE_CATEGORY_KEYWORDS = {
  sc: ["sc", "scheduled caste"],
  st: ["st", "scheduled tribe", "tribal"],
  obc: ["obc", "other backward class", "backward class"],
  ews: ["ews", "economically weaker section"],
  minority: ["minority"],
  general: ["general category", "open category"],
};

const SESSION_TTL_MS = 1000 * 60 * 60 * 24;
const sessionMemory = new Map();

function escapeRegex(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasKeyword(text, keyword) {
  if (keyword.length <= 3) {
    const pattern = new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i");
    return pattern.test(text);
  }
  return text.toLowerCase().includes(keyword.toLowerCase());
}

/**
 * Validate required environment variables
 */
const requiredEnv = ["OPENAI_API_KEY", "SUPABASE_URL", "SUPABASE_KEY"];
const missingEnv = requiredEnv.filter((k) => !process.env[k]);

if (missingEnv.length) {
  console.error("Missing required env vars:", missingEnv.join(", "));
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.json({ status: "yojana-ai running" });
});

function cleanupSessions() {
  const now = Date.now();
  for (const [sessionId, payload] of sessionMemory.entries()) {
    if (now - payload.updatedAt > SESSION_TTL_MS) {
      sessionMemory.delete(sessionId);
    }
  }
}

function getOrCreateSession(sessionIdInput) {
  const incoming = typeof sessionIdInput === "string" && sessionIdInput.trim() ? sessionIdInput.trim() : null;
  const sessionId = incoming || randomUUID();
  const existing = sessionMemory.get(sessionId) || {
    profile: {},
    updatedAt: Date.now(),
  };
  existing.updatedAt = Date.now();
  sessionMemory.set(sessionId, existing);
  return { sessionId, session: existing };
}

function toNumber(value) {
  if (!value) return null;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function unitMultiplier(unit) {
  if (!unit) return 1;
  const normalized = unit.toLowerCase();
  if (["lakh", "lakhs", "lac", "lacs"].includes(normalized)) return 100000;
  if (["crore", "crores"].includes(normalized)) return 10000000;
  if (["k", "thousand"].includes(normalized)) return 1000;
  return 1;
}

function extractState(text) {
  const lower = text.toLowerCase();
  return STATES.find((s) => lower.includes(s)) || null;
}

function extractProfession(text) {
  const lower = text.toLowerCase();
  for (const [profession, keywords] of Object.entries(PROFESSION_KEYWORDS)) {
    if (keywords.some((keyword) => lower.includes(keyword))) {
      return profession;
    }
  }
  return null;
}

function extractIncome(text) {
  const patterns = [
    /(?:income|salary|earning|annual income|yearly income)[^\d]{0,20}(?:rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)(?:\s*(lakh|lakhs|lac|lacs|crore|crores|k|thousand))?/i,
    /(?:rs\.?|inr)\s*([\d,]+(?:\.\d+)?)(?:\s*(lakh|lakhs|lac|lacs|crore|crores|k|thousand))?/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const base = toNumber(match[1]);
    if (base == null) continue;

    return Math.round(base * unitMultiplier(match[2]));
  }

  return null;
}

function extractLandAcres(text) {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(acre|acres|hectare|hectares|ha)\b/i);
  if (!match) return null;

  const raw = Number(match[1]);
  if (!Number.isFinite(raw)) return null;

  const unit = match[2].toLowerCase();
  if (unit === "hectare" || unit === "hectares" || unit === "ha") {
    return Number((raw * 2.47105).toFixed(2));
  }

  return raw;
}

function extractSchemePreference(text) {
  const lower = text.toLowerCase();
  if (/(central scheme|central government|national scheme|all india)/.test(lower)) return "central";
  if (/(state scheme|state government)/.test(lower)) return "state";
  return null;
}

function extractCasteCategory(text) {
  for (const [category, keywords] of Object.entries(CASTE_CATEGORY_KEYWORDS)) {
    if (keywords.some((keyword) => hasKeyword(text, keyword))) {
      return category;
    }
  }
  return null;
}

function extractProfileFromText(text) {
  return {
    state: extractState(text),
    profession: extractProfession(text),
    incomeAnnual: extractIncome(text),
    landAcres: extractLandAcres(text),
    schemePreference: extractSchemePreference(text),
    casteCategory: extractCasteCategory(text),
  };
}

function mergeProfile(existing, incoming) {
  return {
    state: incoming.state || existing.state || null,
    profession: incoming.profession || existing.profession || null,
    incomeAnnual: incoming.incomeAnnual != null ? incoming.incomeAnnual : existing.incomeAnnual ?? null,
    landAcres: incoming.landAcres != null ? incoming.landAcres : existing.landAcres ?? null,
    schemePreference: incoming.schemePreference || existing.schemePreference || null,
    casteCategory: incoming.casteCategory || existing.casteCategory || null,
  };
}

function hasAnyProfile(profile) {
  return [
    profile.state,
    profile.profession,
    profile.incomeAnnual,
    profile.landAcres,
    profile.schemePreference,
    profile.casteCategory,
  ].some((v) => v != null);
}

function extractUpperBoundMoney(text) {
  const patterns = [
    /(?:income\s*(?:up to|upto|below|under|less than|not exceeding)|annual income\s*(?:up to|below|under|less than|not exceeding))[^\d]{0,20}(?:rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)(?:\s*(lakh|lakhs|lac|lacs|crore|crores|k|thousand))?/i,
    /(?:income\s*<=|income\s*<)\s*(?:rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)(?:\s*(lakh|lakhs|lac|lacs|crore|crores|k|thousand))?/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const base = toNumber(match[1]);
    if (base == null) continue;
    return Math.round(base * unitMultiplier(match[2]));
  }

  return null;
}

function extractUpperBoundLandAcres(text) {
  const patterns = [
    /(?:land(?:holding)?\s*(?:up to|upto|below|under|less than|not exceeding)|for farmers with land(?:holding)?\s*(?:up to|below|under|less than|not exceeding))[^\d]{0,20}(\d+(?:\.\d+)?)\s*(acre|acres|hectare|hectares|ha)/i,
    /(?:up to|upto|below|under|less than|not exceeding)\s*(\d+(?:\.\d+)?)\s*(acre|acres|hectare|hectares|ha)\s*(?:of\s*)?(?:land|landholding)?/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const raw = Number(match[1]);
    if (!Number.isFinite(raw)) continue;
    const unit = match[2].toLowerCase();
    if (unit === "hectare" || unit === "hectares" || unit === "ha") {
      return Number((raw * 2.47105).toFixed(2));
    }
    return raw;
  }

  return null;
}

function isCentralScheme(text) {
  return /(pradhan mantri|pm-|government of india|ministry of|national scheme|centrally sponsored|all india|central government)/i.test(
    text
  );
}

function isStateScheme(text) {
  return (
    /(state government|department of .* state|state scheme)/i.test(text) ||
    STATES.some((state) => text.toLowerCase().includes(state))
  );
}

function extractMentionedStates(text) {
  const lower = text.toLowerCase();
  return STATES.filter((state) => lower.includes(state));
}

function evaluateIncome(profile, schemeText) {
  if (profile.incomeAnnual == null) return { score: 0, hardReject: false, reason: null };

  const maxIncome = extractUpperBoundMoney(schemeText);
  if (maxIncome == null) {
    if (/income|bpl|e ws|ews/.test(schemeText.toLowerCase())) {
      return { score: 4, hardReject: false, reason: "mentions income criteria" };
    }
    return { score: 0, hardReject: false, reason: null };
  }

  if (profile.incomeAnnual <= maxIncome) {
    return { score: 25, hardReject: false, reason: `income <= ${maxIncome}` };
  }

  return { score: -25, hardReject: true, reason: `income above ${maxIncome}` };
}

function evaluateLand(profile, schemeText) {
  if (profile.landAcres == null) return { score: 0, hardReject: false, reason: null };

  const maxLand = extractUpperBoundLandAcres(schemeText);
  if (maxLand == null) {
    if (/acre|hectare|landholding|small and marginal farmer|marginal farmer/.test(schemeText.toLowerCase())) {
      return { score: 8, hardReject: false, reason: "mentions land criteria" };
    }
    return { score: 0, hardReject: false, reason: null };
  }

  if (profile.landAcres <= maxLand) {
    return { score: 15, hardReject: false, reason: `land <= ${maxLand} acres` };
  }

  return { score: -20, hardReject: true, reason: `land above ${maxLand} acres` };
}

function evaluateCasteCategory(profile, schemeText) {
  if (!profile.casteCategory) return { score: 0, reason: null };

  const lowerText = schemeText.toLowerCase();
  const categoryKeywords = CASTE_CATEGORY_KEYWORDS[profile.casteCategory] || [];
  const hasSpecificCategory = categoryKeywords.some((k) => hasKeyword(lowerText, k));
  if (hasSpecificCategory) {
    return { score: 10, reason: `category match ${profile.casteCategory} +10` };
  }

  if (/(sc|st|obc|ews|minority|category|reserved)/i.test(schemeText)) {
    return { score: 3, reason: "mentions social category criteria +3" };
  }

  return { score: 0, reason: null };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function scoreMatch(match, profile) {
  const rawText = JSON.stringify(match.raw_json || "");
  const lowerText = rawText.toLowerCase();

  let ruleScore = 0;
  const reasons = [];
  let hardReject = false;
  const isCentral = isCentralScheme(rawText);
  const mentionedStates = extractMentionedStates(rawText);
  let eligibilityPoints = 0;
  const eligibilityMax = 115;

  if (profile.state) {
    if (lowerText.includes(profile.state)) {
      ruleScore += 20;
      reasons.push("state match +20");
      eligibilityPoints += 20;
    } else if (isCentral) {
      ruleScore += 4;
      reasons.push("central fallback +4");
      eligibilityPoints += 4;
    }

    if (!isCentral && mentionedStates.length > 0 && !mentionedStates.includes(profile.state)) {
      hardReject = true;
      reasons.push("hard reject: explicit different state scheme");
      ruleScore -= 30;
    }
  }

  if (profile.profession && PROFESSION_KEYWORDS[profile.profession]) {
    const keywords = PROFESSION_KEYWORDS[profile.profession];
    if (keywords.some((k) => lowerText.includes(k))) {
      ruleScore += 10;
      reasons.push("profession match +10");
      eligibilityPoints += 10;
    }
  }

  const landScore = evaluateLand(profile, rawText);
  if (landScore.reason) reasons.push(`land: ${landScore.reason} (${landScore.score >= 0 ? "+" : ""}${landScore.score})`);
  ruleScore += landScore.score;
  if (landScore.score > 0) eligibilityPoints += landScore.score;
  hardReject = hardReject || landScore.hardReject;

  const incomeScore = evaluateIncome(profile, rawText);
  if (incomeScore.reason)
    reasons.push(`income: ${incomeScore.reason} (${incomeScore.score >= 0 ? "+" : ""}${incomeScore.score})`);
  ruleScore += incomeScore.score;
  if (incomeScore.score > 0) eligibilityPoints += incomeScore.score;
  hardReject = hardReject || incomeScore.hardReject;

  const casteScore = evaluateCasteCategory(profile, rawText);
  if (casteScore.reason) reasons.push(casteScore.reason);
  ruleScore += casteScore.score;
  if (casteScore.score > 0) eligibilityPoints += casteScore.score;

  if (profile.schemePreference === "central") {
    if (isCentral) {
      ruleScore += 15;
      reasons.push("central preference +15");
      eligibilityPoints += 15;
    } else {
      ruleScore -= 4;
    }
  }

  if (profile.schemePreference === "state") {
    if (isStateScheme(rawText)) {
      ruleScore += 15;
      reasons.push("state preference +15");
      eligibilityPoints += 15;
    } else {
      ruleScore -= 4;
    }
  }

  const semanticScore = Number(match.similarity || 0) * 100;
  eligibilityPoints += Number(match.similarity || 0) * 20;
  const finalScore = semanticScore + ruleScore;
  let eligibilityProbability = Math.round((eligibilityPoints / eligibilityMax) * 100);
  eligibilityProbability = clamp(eligibilityProbability, 5, 99);
  if (hardReject) eligibilityProbability = Math.min(eligibilityProbability, 30);

  return {
    ...match,
    semanticScore,
    ruleScore,
    finalScore,
    eligibilityProbability,
    hardReject,
    scoreReasons: reasons,
  };
}

function valueToText(value, maxLen = 280) {
  if (value == null) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text ? text.slice(0, maxLen) : null;
}

function extractLinksFromText(text) {
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s"\\]+/g) || [];
  return [...new Set(matches)].slice(0, 3);
}

function extractReadiness(match) {
  const raw = match.raw_json?.data?.en || {};
  const wholeText = JSON.stringify(raw || "");
  const links = extractLinksFromText(wholeText);

  const documentsRequired =
    valueToText(raw.documentsRequired) ||
    valueToText(raw.requiredDocuments) ||
    valueToText(raw.schemeDocuments) ||
    valueToText(raw.eligibilityCriteria?.documentsRequired) ||
    null;

  const applyOnline =
    valueToText(raw.howToApply?.onlineApplication) ||
    valueToText(raw.howToApply?.online) ||
    valueToText(raw.applicationProcess?.online) ||
    links[0] ||
    null;

  const applyOffline =
    valueToText(raw.howToApply?.offlineApplication) ||
    valueToText(raw.howToApply?.offline) ||
    valueToText(raw.applicationProcess?.offline) ||
    valueToText(raw.whereToApply) ||
    null;

  const contactInfo =
    valueToText(raw.contactDetails) ||
    valueToText(raw.helpline) ||
    valueToText(raw.contact) ||
    null;

  return {
    documentsRequired,
    applyOnline,
    applyOffline,
    contactInfo,
    links,
  };
}

function rankMatches(matches, profile) {
  const scored = matches.map((m) => scoreMatch(m, profile));

  const preferred = scored.filter((m) => !m.hardReject);
  const base = preferred.length > 0 ? preferred : scored;

  return base.sort((a, b) => b.finalScore - a.finalScore);
}

function buildContext(rankedMatches) {
  return rankedMatches
    .map((m, index) => {
      let raw = m.raw_json?.data?.en || {};
      const readiness = extractReadiness(m);

      let description = raw.schemeContent?.briefDescription || raw.schemeContent?.schemeContent || "";
      let eligibility =
        raw.eligibilityCriteria?.eligibilityDescription_md || raw.eligibilityCriteria?.description || "";
      let benefits = raw.schemeBenefits?.benefits || raw.schemeBenefits?.description || "";

      if (typeof description !== "string") description = JSON.stringify(description);
      if (typeof eligibility !== "string") eligibility = JSON.stringify(eligibility);
      if (typeof benefits !== "string") benefits = JSON.stringify(benefits);

      description = description.slice(0, 700);
      eligibility = eligibility.slice(0, 500);
      benefits = benefits.slice(0, 400);

      return `
Scheme ${index + 1}
Name: ${m.name}
Semantic Similarity: ${m.semanticScore.toFixed(2)}
Rule Score: ${m.ruleScore}
Final Rank Score: ${m.finalScore.toFixed(2)}
Eligibility Probability: ${m.eligibilityProbability}%
Scoring Reasons: ${m.scoreReasons.join("; ") || "none"}

Description:
${description}

Eligibility:
${eligibility}

Benefits:
${benefits}

Application Readiness:
Documents Required: ${readiness.documentsRequired || "Not specified"}
Apply Online: ${readiness.applyOnline || "Not specified"}
Apply Offline: ${readiness.applyOffline || "Not specified"}
Contact: ${readiness.contactInfo || "Not specified"}
`;
    })
    .join("\n---------------------------------\n");
}

function profileToText(profile) {
  const parts = [];
  if (profile.state) parts.push(`State: ${profile.state}`);
  if (profile.profession) parts.push(`Profession: ${profile.profession}`);
  if (profile.landAcres != null) parts.push(`Land: ${profile.landAcres} acres`);
  if (profile.incomeAnnual != null) parts.push(`Annual income: INR ${profile.incomeAnnual}`);
  if (profile.casteCategory) parts.push(`Social category: ${profile.casteCategory}`);
  if (profile.schemePreference) parts.push(`Preference: ${profile.schemePreference} schemes`);
  return parts.join(" | ") || "No saved profile yet";
}

function getInterviewState(profile) {
  const missingFields = [];
  if (!profile.state) missingFields.push("state");
  if (!profile.profession) missingFields.push("profession");
  if (profile.profession === "farmer" && profile.landAcres == null) missingFields.push("landAcres");
  if (profile.incomeAnnual == null) missingFields.push("incomeAnnual");
  if (!profile.casteCategory) missingFields.push("casteCategory");

  let nextQuestion = null;
  if (missingFields.includes("state")) nextQuestion = "Which state do you live in?";
  else if (missingFields.includes("profession")) nextQuestion = "What is your profession (for example farmer, student, worker, entrepreneur)?";
  else if (missingFields.includes("landAcres")) nextQuestion = "How many acres of land do you own?";
  else if (missingFields.includes("incomeAnnual")) nextQuestion = "What is your annual household income in INR?";
  else if (missingFields.includes("casteCategory"))
    nextQuestion = "What is your social category (SC, ST, OBC, EWS, minority, or general)?";

  return { missingFields, nextQuestion };
}

app.post("/chat", async (req, res) => {
  try {
    cleanupSessions();

    const { question, sessionId: incomingSessionId } = req.body;

    if (!question || question.trim().length === 0) {
      return res.status(400).json({
        error: "Question is required",
      });
    }

    const { sessionId, session } = getOrCreateSession(incomingSessionId);

    console.log("\n------------------------------");
    console.log("Session:", sessionId);
    console.log("User question:", question);

    const extractedProfile = extractProfileFromText(question);
    const mergedProfile = mergeProfile(session.profile, extractedProfile);
    session.profile = mergedProfile;
    session.updatedAt = Date.now();

    const retrievalQuery = hasAnyProfile(mergedProfile)
      ? `${question}\n\nKnown user profile: ${profileToText(mergedProfile)}`
      : question;

    const embedding = await generateEmbedding(retrievalQuery);
    let matches = await searchSchemes(embedding);

    if (!matches || matches.length === 0) {
      const interviewState = getInterviewState(mergedProfile);
      return res.json({
        sessionId,
        memory: mergedProfile,
        interview: interviewState,
        answer:
          "I could not find relevant schemes. Please add details like state, profession, income, land size, or target scheme type.",
        matches: [],
      });
    }

    const rankedMatches = rankMatches(matches, mergedProfile).slice(0, 5);
    const context = buildContext(rankedMatches);
    const memoryContext = profileToText(mergedProfile);
    const interviewState = getInterviewState(mergedProfile);

    const answer = await generateChatResponse(
      question,
      context,
      memoryContext,
      interviewState.nextQuestion
    );

    return res.json({
      sessionId,
      memory: mergedProfile,
      interview: interviewState,
      answer,
      matches: rankedMatches.map((m) => ({
        name: m.name,
        similarity: Number(m.similarity || 0),
        semanticScore: Number(m.semanticScore.toFixed(2)),
        ruleScore: m.ruleScore,
        finalScore: Number(m.finalScore.toFixed(2)),
        eligibilityProbability: m.eligibilityProbability,
        scoreReasons: m.scoreReasons,
        readiness: extractReadiness(m),
      })),
    });
  } catch (err) {
    console.error("FULL ERROR DUMP:");
    console.error(err?.stack || err);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Yojana AI running on port ${PORT}`);
});
