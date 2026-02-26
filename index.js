require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { randomUUID, createHash } = require("crypto");
const { generateEmbedding, generateChatResponse } = require("./lib/openai");
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

function normalizeMatches(matches) {
  return (matches || []).map((m) => ({
    ...m,
    name: m.name || m.scheme_name || m.title || m.slug || "Unnamed scheme",
    similarity: Number(m.similarity || 0),
  }));
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

app.post("/chat", async (req, res) => {
  try {
    cleanupSessions();
    const { question, sessionId: sessionIdInput } = req.body;

    if (!question || question.trim().length === 0) {
      return res.status(400).json({ error: "Question is required" });
    }

    const { sessionId, session } = getSession(sessionIdInput, req);
    const mergedProfile = mergeProfile(session.profile || {}, extractProfile(question));
    session.profile = mergedProfile;
    session.updatedAt = Date.now();

    console.log("\n------------------------------");
    console.log("Session:", sessionId);
    console.log("User question:", question);

    const query = `${question}\n\nKnown profile: ${profileText(mergedProfile)}`;
    const embedding = await generateEmbedding(query);
    let matches = await searchSchemes(embedding);
    matches = rankMatches(matches, mergedProfile);

    const nextQuestion = getNextQuestion(mergedProfile);

    if (!matches.length) {
      return res.json({
        sessionId,
        memory: mergedProfile,
        interview: { nextQuestion },
        answer:
          nextQuestion || "I could not find relevant schemes right now. Please try another wording or share more details.",
        matches: [],
      });
    }

    const context = buildContext(matches);
    const answer = await generateChatResponse(question, context, profileText(mergedProfile), nextQuestion);

    return res.json({
      sessionId,
      memory: mergedProfile,
      interview: { nextQuestion },
      answer,
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
