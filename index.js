require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { randomUUID, createHash } = require("crypto");
const { generateEmbedding, generateChatResponse, translateText, classifyIntentModel } = require("./lib/openai");
const { searchSchemes, verifyAccessToken } = require("./lib/supabase");

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

const CITY_TO_STATE = {
  kolkata: "west bengal",
  howrah: "west bengal",
  siliguri: "west bengal",
  chennai: "tamil nadu",
  coimbatore: "tamil nadu",
  madurai: "tamil nadu",
  trichy: "tamil nadu",
  bengaluru: "karnataka",
  bangalore: "karnataka",
  mysuru: "karnataka",
  mumbai: "maharashtra",
  pune: "maharashtra",
  nagpur: "maharashtra",
  nashik: "maharashtra",
  hyderabad: "telangana",
  warangal: "telangana",
  delhi: "delhi",
  newdelhi: "delhi",
  gurgaon: "haryana",
  gurugram: "haryana",
  faridabad: "haryana",
  noida: "uttar pradesh",
  ghaziabad: "uttar pradesh",
  lucknow: "uttar pradesh",
  kanpur: "uttar pradesh",
  varanasi: "uttar pradesh",
  patna: "bihar",
  gaya: "bihar",
  ranchi: "jharkhand",
  jamshedpur: "jharkhand",
  bokaro: "jharkhand",
  guwahati: "assam",
  dibrugarh: "assam",
  itanagar: "arunachal pradesh",
  tawang: "arunachal pradesh",
  jaipur: "rajasthan",
  jodhpur: "rajasthan",
  udaipur: "rajasthan",
  ahmedabad: "gujarat",
  surat: "gujarat",
  vadodara: "gujarat",
  bhopal: "madhya pradesh",
  indore: "madhya pradesh",
  raipur: "chhattisgarh",
  bhubaneswar: "odisha",
  cuttack: "odisha",
  chandigarh: "chandigarh",
  shimla: "himachal pradesh",
  dehradun: "uttarakhand",
  srinagar: "jammu and kashmir",
};

const PROFESSION_KEYWORDS = {
  farmer: ["farmer", "agriculture", "kisan", "cultivator"],
  student: ["student", "school", "college"],
  worker: ["worker", "labour", "labor", "daily wage"],
  entrepreneur: [
    "business",
    "entrepreneur",
    "startup",
    "self employed",
    "self-employed",
    "shop",
    "store",
    "medical shop",
    "medicine shop",
    "pharmacy",
    "dukan",
    "dukandar",
    "trader",
  ],
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
const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ||
  "http://localhost:3000,https://yojana-web-production.up.railway.app"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);


const app = express();
app.set("trust proxy", true);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("CORS blocked"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
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

function getSession(sessionIdInput, req, userId = null) {
  const provided = typeof sessionIdInput === "string" && sessionIdInput.trim().length > 0;
  let sessionId;
  if (userId) {
    sessionId = provided ? `${userId}:${sessionIdInput.trim()}` : userId;
  } else {
    sessionId = provided ? sessionIdInput.trim() : fallbackSessionId(req) || randomUUID();
  }
  const existing = sessionMemory.get(sessionId) || { profile: {}, updatedAt: Date.now() };
  existing.updatedAt = Date.now();
  sessionMemory.set(sessionId, existing);
  return { sessionId, session: existing, sessionIdProvided: provided };
}

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await verifyAccessToken(token);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    req.user = user;
    return next();
  } catch (_) {
    return res.status(401).json({ error: "Unauthorized" });
  }
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
  const lower = String(text || "").toLowerCase();
  const explicit = STATES.find((s) => lower.includes(s));
  if (explicit) return explicit;
  for (const [city, state] of Object.entries(CITY_TO_STATE)) {
    if (lower.includes(city)) return state;
  }
  return null;
}

function extractByKeywords(text, dict) {
  const lower = text.toLowerCase();
  for (const [key, keywords] of Object.entries(dict)) {
    if (keywords.some((kw) => lower.includes(kw))) return key;
  }
  return null;
}

function extractIncome(text) {
  if (/\b(no income|zero income|income is zero|without income|no earning|no earnings|no money|no cash|income nil)\b/i.test(text)) {
    return 0;
  }
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

function extractAge(text) {
  const patterns = [
    /(?:i am|i'm|im|age|aged)\s*(\d{1,2})\b/i,
    /(\d{1,2})\s*(?:years old|year old|yrs old|yrs|years)\b/i,
    /(\d{1,2})\s*(?:saal|varsh|saal ka|saal ki)\b/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (!m) continue;
    const age = Number(m[1]);
    if (Number.isFinite(age) && age >= 1 && age <= 120) return age;
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
    age: extractAge(question),
    profession: extractByKeywords(question, PROFESSION_KEYWORDS),
    category: extractByKeywords(question, CATEGORY_KEYWORDS),
    incomeAnnual: extractIncome(question),
    landAcres: extractLandAcres(question),
  };
}

function detectBlankProfileTemplate(text) {
  const raw = String(text || "");
  const normalized = raw.toLowerCase();
  const labels = ["state:", "age:", "category:", "occupation:", "family income:", "need:"];
  const labelHits = labels.filter((l) => normalized.includes(l)).length;
  if (labelHits < 4) return false;

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const labeledLines = lines.filter((l) => /^(state|age|category|occupation|family income|need)\s*:/i.test(l));
  if (!labeledLines.length) return false;

  const nonEmptyValues = labeledLines.filter((l) => {
    const value = l.replace(/^(state|age|category|occupation|family income|need)\s*:/i, "").trim();
    return value.length > 0;
  });

  return nonEmptyValues.length === 0;
}

function isResetCommand(text) {
  return /(reset profile|start over|new chat|clear memory|forget details|forget profile)/i.test(String(text || ""));
}

function isDisengageText(text) {
  const raw = String(text || "").trim().toLowerCase();
  if (!raw) return false;
  if (/\b(no income|zero income|without income|no earning|no earnings|no money|no cash|income nil)\b/.test(raw)) return false;
  return /\b(nope|nah|not now|later|stop|cancel|leave it|drop it|skip|nothing|i don't want|i dont want|don't want|dont want|not interested|no thanks|bye)\b/.test(
    raw
  );
}

function mergeProfile(oldProfile, newProfile) {
  return {
    state: newProfile.state || oldProfile.state || null,
    age: newProfile.age != null ? newProfile.age : oldProfile.age ?? null,
    profession: newProfile.profession || oldProfile.profession || null,
    category: newProfile.category || oldProfile.category || null,
    incomeAnnual: newProfile.incomeAnnual != null ? newProfile.incomeAnnual : oldProfile.incomeAnnual ?? null,
    landAcres: newProfile.landAcres != null ? newProfile.landAcres : oldProfile.landAcres ?? null,
  };
}

function profileText(profile) {
  const fields = [];
  if (profile.state) fields.push(`State: ${profile.state}`);
  if (profile.age != null) fields.push(`Age: ${profile.age}`);
  if (profile.profession) fields.push(`Profession: ${profile.profession}`);
  if (profile.category) fields.push(`Category: ${profile.category}`);
  if (profile.incomeAnnual != null) fields.push(`Annual income INR: ${profile.incomeAnnual}`);
  if (profile.landAcres != null) fields.push(`Land acres: ${profile.landAcres}`);
  return fields.join(" | ") || "No profile captured";
}

function hasProfileSignal(profile) {
  return !!(profile.state || profile.profession || profile.category || profile.incomeAnnual != null || profile.landAcres != null);
}

function getNextQuestion(profile) {
  if (!profile.state) return "Which state do you live in?";
  if (profile.age == null) return "What is your age?";
  if (!profile.profession) return "What is your profession (farmer, student, worker, entrepreneur)?";
  if (profile.profession === "farmer" && profile.landAcres == null) return "How many acres of land do you own?";
  if (profile.incomeAnnual == null) return "What is your annual household income in INR?";
  if (!profile.category) return "What is your social category (SC, ST, OBC, EWS, minority, or general)?";
  return null;
}

function classifyIntent(question, session) {
  const text = normalizeText(question);
  const tokens = text.split(" ").filter(Boolean);
  const rawTrim = String(question || "").trim();
  if (!/[a-z0-9]/i.test(rawTrim) && rawTrim.length > 0) return { intent: "smalltalk_noise", confidence: 0.99 };
  if (isLikelyGibberish(rawTrim)) return { intent: "nonsense_noise", confidence: 0.99 };
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

  const ackWords = new Set(["yes", "no", "yep", "nope", "maybe", "sure", "ok", "okay", "done"]);
  if (tokens.length > 0 && tokens.length <= 2 && tokens.every((t) => ackWords.has(t))) {
    return { intent: "unclear_ack", confidence: 0.9 };
  }

  const hasStateComplaint =
    /(i asked|why|wrong|instead|you gave|you are giving|other state|another state|not.*state)/i.test(question) &&
    /(state|arunachal|maharashtra|jharkhand|rajasthan|gujarat|karnataka|punjab|haryana)/i.test(question);
  if (hasStateComplaint) return { intent: "complaint_correction", confidence: 0.95 };
  if (isOutOfScopeText(question)) return { intent: "out_of_scope", confidence: 0.9 };

  if (isCompareIntent(question)) return { intent: "compare_request", confidence: 0.9 };
  if (extractSelectionIndex(question) != null) return { intent: "selection", confidence: 0.9 };
  if (isSelectionIntent(question)) return { intent: "selection", confidence: 0.85 };
  if (isDetailIntent(question)) return { intent: "detail_request", confidence: 0.8 };

  const pendingQuestion = session.pendingQuestion || null;
  if (pendingQuestion && text.split(" ").length <= 8) {
    return { intent: "clarification_answer", confidence: 0.7 };
  }

  return { intent: "new_discovery", confidence: 0.7 };
}

async function classifyIntentSmart(question, session) {
  try {
    const modelResult = await classifyIntentModel(question, {
      pendingQuestion: session.pendingQuestion || null,
      hasSelectedScheme: !!session.selectedScheme,
      lastAssistantAction: session.lastAssistantAction || null,
    });

    const validIntents = new Set([
      "smalltalk_noise",
      "nonsense_noise",
      "unclear_ack",
      "complaint_correction",
      "compare_request",
      "selection",
      "detail_request",
      "clarification_answer",
      "out_of_scope",
      "new_discovery",
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
    // fall back below
  }

  const fallback = classifyIntent(question, session);
  return { ...fallback, source: "rule" };
}

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

function hasSchemeDomainSignal(text, profile = null) {
  const q = String(text || "").toLowerCase();
  const keywords = [
    "scheme",
    "schemes",
    "yojana",
    "scholarship",
    "pension",
    "benefit",
    "subsidy",
    "loan",
    "apply",
    "application",
    "eligibility",
    "document",
    "office",
    "helpline",
    "government support",
    "sarkari",
    "madad",
    "yojnaa",
    "yojna",
    "kisan",
    "farmer",
    "student",
    "business",
    "msme",
    "startup",
    "upsc",
    "coaching",
    "scheme ke bare",
    "योजना",
    "छात्रवृत्ति",
    "पेंशन",
    "लाभ",
    "पात्रता",
    "दस्तावेज",
    "माहिती",
    "शिष्यवृत्ती",
    "पेन्शन",
    "कागदपत्र",
  ];
  if (keywords.some((k) => q.includes(k))) return true;
  if (extractState(q)) return true;
  if (profile && hasProfileSignal(profile)) return true;
  return false;
}

function isOutOfScopeText(text) {
  const q = String(text || "").toLowerCase();
  if (!q.trim()) return false;
  if (hasSchemeDomainSignal(q)) return false;
  if (isDisengageText(q)) return false;

  const outScopeHints = [
    "joke",
    "funny",
    "song",
    "lyrics",
    "movie",
    "cricket score",
    "ipl",
    "bitcoin",
    "stock",
    "coding",
    "python",
    "javascript",
    "relationship",
    "girlfriend",
    "boyfriend",
    "weather",
    "news",
    "time now",
    "translate this",
  ];
  return outScopeHints.some((k) => q.includes(k));
}

function discoverySignal(question, profile, session) {
  const q = normalizeText(question);
  const tokens = q.split(" ").filter(Boolean);
  const hasProfile = !!(
    profile.state ||
    profile.age != null ||
    profile.profession ||
    profile.category ||
    profile.incomeAnnual ||
    profile.landAcres
  );
  const schemeIntent = /(scheme|scholarship|pension|benefit|loan|subsidy|support|help|apply|eligibility|yojana)/i.test(
    question
  );
  const actionIntent = /(find|need|want|show|give|suggest|recommend|tell)/i.test(question);
  const hasNumbers = /\d/.test(question);
  const referencesSelected =
    !!session.selectedScheme && tokenSet(question).size > 0 && tokenSet(session.selectedScheme.name).size > 0;

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

function isCentralScheme(raw) {
  return /(pradhan mantri|pm-|government of india|ministry of|national scheme|centrally sponsored|all india|central government)/i.test(
    raw
  );
}

function extractMentionedStates(raw) {
  const lower = raw.toLowerCase();
  const states = new Set(STATES.filter((s) => lower.includes(s)));
  for (const [city, state] of Object.entries(CITY_TO_STATE)) {
    if (lower.includes(city)) states.add(state);
  }
  return [...states];
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
    if (mentionedStates.length === 0) {
      if (isCentralScheme(raw)) return true;
      droppedCount += 1;
      return false;
    }
    if (mentionedStates.includes(profile.state)) return true;
    if (isCentralScheme(raw)) return true;
    droppedCount += 1;
    return false;
  });

  return {
    matches: filtered,
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
  return /(more|detail|details|about|apply|application|process|how to|how do|documents|document|eligibility|link|website|form|office|address|contact|helpline|baare|bare|batao|samjhao|apply kaise|kagaz|dastavez|mahiti|tapshil|जानकारी|विवरण|दस्तावेज|लिंक|पता|कार्यालय|माहिती|तपशील)/i.test(
    question
  );
}

function isCompareIntent(question) {
  return /(compare|difference|vs|versus|better|best among|which is better)/i.test(question);
}

function isSelectionIntent(question) {
  return /(^\s*\d{1,2}\s*$|select|choose|pick|go with|finalize|this one|that one|first one|second one|third one|option\s*\d{1,2}|scheme\s*\d{1,2}|no\.?\s*\d{1,2}|pehla|pahla|dusra|doosra|teesra|tisra|पहला|दूसरा|तीसरा|पहिली|दुसरी|तिसरी)/i.test(
    question
  );
}

function extractSelectionIndex(question) {
  const raw = String(question || "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const tokenCount = lower.split(/\s+/).filter(Boolean).length;

  const exactDigit = lower.match(/^(?:option|scheme|number|no\.?)?\s*(\d{1,2})(?:st|nd|rd|th)?\s*(?:option|scheme)?$/i);
  if (exactDigit) {
    const n = Number(exactDigit[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 10) return n - 1;
  }

  const contextualDigit = lower.match(/\b(?:option|scheme|number|no\.?)\s*(\d{1,2})(?:st|nd|rd|th)?\b/i);
  if (contextualDigit) {
    const n = Number(contextualDigit[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 10) return n - 1;
  }

  const ordinals = [
    { idx: 0, keys: ["first", "1st", "pehla", "pahla", "पहला", "पहिली"] },
    { idx: 1, keys: ["second", "2nd", "dusra", "doosra", "दूसरा", "दुसरी"] },
    { idx: 2, keys: ["third", "3rd", "teesra", "tisra", "तीसरा", "तिसरी"] },
    { idx: 3, keys: ["fourth", "4th", "chautha", "चौथा"] },
    { idx: 4, keys: ["fifth", "5th", "paanchwa", "पांचवा"] },
  ];
  for (const entry of ordinals) {
    if (entry.keys.some((k) => lower.includes(k))) return entry.idx;
  }

  if (tokenCount <= 3) {
    const shortDigit = lower.match(/\b(\d{1,2})\b/);
    if (shortDigit) {
      const n = Number(shortDigit[1]);
      if (Number.isFinite(n) && n >= 1 && n <= 10) return n - 1;
    }
  }

  return null;
}

function pickBySelectionIndex(candidateMatches, selectionIndex) {
  if (!Number.isInteger(selectionIndex) || selectionIndex < 0) return null;
  const items = normalizeMatches(candidateMatches);
  if (!items.length || selectionIndex >= items.length) return null;
  return items[selectionIndex];
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
  if (mode === "list") {
    return /(1\.\s|2\.\s|eligibility probability|here are)/.test(text);
  }
  if (mode === "focused") {
    return !/(1\.\s|2\.\s|here are some relevant schemes)/.test(text);
  }
  if (mode === "compare") {
    return /(scheme a|scheme b|difference|compared|versus|vs)/.test(text);
  }
  if (mode === "clarify") {
    return !/(1\.\s|2\.\s|eligibility probability|here are)/.test(text);
  }
  return true;
}

async function generateValidatedModeAnswer({
  question,
  context,
  memoryContext,
  nextQuestion = null,
  mode,
  intent,
  fallbackAnswer,
}) {
  const first = await generateChatResponse(question, context, memoryContext, nextQuestion, mode);
  if (validateGeneratedAnswer(first, mode, intent)) return first;

  const strictQuestion = `STRICT MODE (${mode}) - do not violate mode rules.\n\n${question}`;
  const second = await generateChatResponse(strictQuestion, context, memoryContext, nextQuestion, mode);
  if (validateGeneratedAnswer(second, mode, intent)) return second;

  return fallbackAnswer;
}

async function buildSmalltalkClarifier(session, profile, toUserLanguage) {
  const hasProfile = !!(
    profile.state ||
    profile.age != null ||
    profile.profession ||
    profile.category ||
    profile.incomeAnnual ||
    profile.landAcres
  );
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

async function buildPendingClarifier(session, toUserLanguage) {
  const pendingRaw = String(session.pendingQuestion || "").toLowerCase();
  const pendingMap = {
    "user intent clarification": "your exact request (discover, compare, or scheme details)",
    "state and support type": "your state and support type",
    "state and exact support you need": "your state and exact support you need",
    "state and the support type you need": "your state and support type",
    "which scheme do you mean": "which scheme you mean",
    "scheme name for details": "the exact scheme name for details",
    "which two schemes to compare": "which two schemes you want to compare",
    "fill state, age, category, occupation, income, and need": "your state and what support you need",
  };
  const pending = pendingMap[pendingRaw] || session.pendingQuestion || "what you need help with";
  return toUserLanguage(`Please answer this so I can proceed: ${pending}.`);
}

async function buildPurposeGuidance(toUserLanguage) {
  return toUserLanguage(
    "I can help you discover government schemes, compare options, or guide applications. Tell me your state and what support you need (scholarship, pension, farmer, business, health)."
  );
}

async function buildOutOfScopeGuidance(toUserLanguage, profile = null) {
  const next = profile && hasProfileSignal(profile)
    ? "If you want, continue with your scheme search by telling the exact need (for example: scholarship, pension, business loan, farmer support)."
    : "If you want to continue here, share your state and what support you need (scholarship, pension, business, farmer, health).";
  return toUserLanguage(`I am designed for government scheme guidance only. ${next}`);
}

async function buildContextualGuidance(question, profile, toUserLanguage) {
  const supportType = inferSupportType(question);
  if (supportType === "exam_support") {
    if (!profile.state) {
      return toUserLanguage(
        "For UPSC/exam support schemes, tell me your state first. Then I can suggest coaching/scholarship schemes relevant to your state and category."
      );
    }
    return toUserLanguage(
      "Tell me your category and income range. I will find UPSC/coaching/scholarship schemes for your profile."
    );
  }

  return buildPurposeGuidance(toUserLanguage);
}

async function buildProgressClarifier(profile, toUserLanguage) {
  const summary = [];
  if (profile.age != null) summary.push(`age: ${profile.age}`);
  if (profile.profession) summary.push(`profession: ${profile.profession}`);
  if (profile.incomeAnnual != null) summary.push(`income: INR ${profile.incomeAnnual}`);
  if (profile.category) summary.push(`category: ${profile.category}`);
  if (profile.state) summary.push(`state: ${profile.state}`);
  if (profile.landAcres != null) summary.push(`land: ${profile.landAcres} acres`);

  const nextQuestion = getNextQuestion(profile);
  if (!nextQuestion) {
    return toUserLanguage("Thanks, I have enough profile details. Tell me what type of schemes you want (scholarship, pension, farmer, business, health).");
  }

  if (summary.length === 0) return toUserLanguage(nextQuestion);
  return toUserLanguage(`Noted ${summary.join(", ")}. ${nextQuestion}`);
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

async function translateToMarathi(text) {
  return translateText(text, "Marathi");
}

app.post("/chat", requireAuth, async (req, res) => {
  try {
    cleanupSessions();
    const { question, language = "en", sessionId: sessionIdInput } = req.body;
    const normalizedLanguageInput = String(language || "en").toLowerCase();
    const normalizedLanguage =
      normalizedLanguageInput === "marathi"
        ? "mr"
        : normalizedLanguageInput === "hindi"
          ? "hi"
          : normalizedLanguageInput;

    if (!question || question.trim().length === 0) {
      return res.status(400).json({ error: "Question is required" });
    }

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

    const { sessionId, session, sessionIdProvided } = getSession(sessionIdInput, req, req.user?.id || null);
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

    const extractedThisTurn = extractProfile(canonicalQuestion);
    const previousProfile = session.profile || {};
    const stateChangedThisTurn =
      !!extractedThisTurn.state && !!previousProfile.state && extractedThisTurn.state !== previousProfile.state;
    if (stateChangedThisTurn) {
      session.selectedScheme = null;
      session.lastMatches = [];
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

    const intentMeta = await classifyIntentSmart(canonicalQuestion, session);
    let intent = intentMeta.intent;
    const inDomainByText = hasSchemeDomainSignal(canonicalQuestion, mergedProfile);
    if (intent === "out_of_scope" && inDomainByText) {
      intent = session.pendingQuestion ? "clarification_answer" : "new_discovery";
    }
    if ((intent === "smalltalk_noise" || intent === "unclear_ack") && turnProfileSignal) {
      intent = session.pendingQuestion ? "clarification_answer" : "new_discovery";
    }
    const schemeDomain = inDomainByText;
    if (schemeDomain) {
      session.offTopicCount = 0;
    }
    const canonicalNormalized = normalizeText(canonicalQuestion);
    const isRepeatedLowSignal =
      session.lastCanonicalQuestion &&
      session.lastCanonicalQuestion === canonicalNormalized &&
      canonicalNormalized.split(" ").filter(Boolean).length <= 3;
    session.lastCanonicalQuestion = canonicalNormalized;

    console.log(
      JSON.stringify({
        tag: "chat_turn",
        sessionId,
        userQuestion: question,
        canonicalQuestion,
        intent,
        intentConfidence: intentMeta.confidence,
        intentSource: intentMeta.source || "rule",
        profileState: mergedProfile.state || null,
      })
    );

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

    if (intent === "smalltalk_noise") {
      session.lastAssistantAction = "clarify";
      session.pendingQuestion = "your exact request (discover, compare, or scheme details)";
      return respond({
        memory: mergedProfile,
        interview: { nextQuestion: null },
        answer: await buildSmalltalkClarifier(session, mergedProfile, toUserLanguage),
        matches: [],
      });
    }

    if (intent === "nonsense_noise") {
      session.lastAssistantAction = "clarify";
      session.pendingQuestion = "state and support type";
      return respond({
        memory: mergedProfile,
        interview: { nextQuestion: null },
        answer: await toUserLanguage(
          "I could not understand that text. Please write your request in a sentence, for example: 'I am from Maharashtra and need scholarship schemes.'"
        ),
        matches: [],
      });
    }

    if (intent === "unclear_ack") {
      session.lastAssistantAction = "clarify";
      session.pendingQuestion = session.pendingQuestion || "your exact request (discover, compare, or details)";
      return respond({
        memory: mergedProfile,
        interview: { nextQuestion: null },
        answer: await buildPendingClarifier(session, toUserLanguage),
        matches: [],
      });
    }

    if (intent === "out_of_scope") {
      const offTopicCount = Number(session.offTopicCount || 0) + 1;
      session.offTopicCount = offTopicCount;
      session.lastAssistantAction = "out_of_scope";
      session.pendingQuestion = null;
      if (offTopicCount >= 2) {
        return respond({
          memory: mergedProfile,
          interview: { nextQuestion: null },
          answer: await toUserLanguage(
            "I am only for government scheme guidance, so I will pause this thread here. If you want to continue, send your state and what support you need."
          ),
          matches: [],
        });
      }
      return respond({
        memory: mergedProfile,
        interview: { nextQuestion: null },
        answer: await buildOutOfScopeGuidance(toUserLanguage, mergedProfile),
        matches: [],
      });
    }

    const retrievalIntent = new Set(["new_discovery", "compare_request", "selection", "detail_request", "complaint_correction"]);
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
      return respond({
        memory: mergedProfile,
        interview: { nextQuestion: null },
        answer: targetedPrompt,
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
        const answer = await generateValidatedModeAnswer({
          question: canonicalQuestion,
          context,
          memoryContext: profileText(mergedProfile),
          mode: "compare",
          intent,
          fallbackAnswer: `Comparison summary:\n\nA) ${a.name}\nB) ${b.name}\n\nPlease ask for eligibility/documents/apply steps for either scheme.`,
        });
        const localizedAnswer = await toUserLanguage(answer);
        session.lastAssistantAction = "compare";
        session.pendingQuestion = null;
        return respond({
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
      return respond({
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
      const selectedByIndex = pickBySelectionIndex(previousMatches, extractSelectionIndex(canonicalQuestion));
      const selected =
        selectedByIndex ||
        findFocusedScheme(canonicalQuestion, previousMatches) ||
        normalizeMatches(previousMatches)[0] ||
        null;
      if (selected) {
        const ranked = scoreMatch(selected, mergedProfile);
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
        const finalAnswer = answer;
        const localizedAnswer = await toUserLanguage(finalAnswer);
        session.lastAssistantAction = "focused";
        session.pendingQuestion = null;
        return respond({
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

    const focusedFromHistory =
      pickBySelectionIndex(previousMatches, extractSelectionIndex(canonicalQuestion)) ||
      findFocusedScheme(canonicalQuestion, previousMatches);
    const stickyFocusedScheme =
      focusedFromHistory ||
      (intent === "detail_request" && previousSelectedScheme ? previousSelectedScheme : null);

    if ((intent === "detail_request" || intent === "selection") && previousSelectedScheme && !focusedFromHistory) {
      const forcedFocused = scoreMatch(previousSelectedScheme, mergedProfile);
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
        matches: [
          {
            slug: forcedFocused.slug || null,
            name: forcedFocused.name,
            similarity: Number(forcedFocused.similarity || 0),
            semanticScore: Number(forcedFocused.semanticScore.toFixed(2)),
            ruleScore: forcedFocused.ruleScore,
            finalScore: Number(forcedFocused.finalScore.toFixed(2)),
            eligibilityProbability: forcedFocused.eligibilityProbability,
          },
        ],
      });
    }

    if (intent === "detail_request" && stickyFocusedScheme) {
      const focusedRanked = scoreMatch(stickyFocusedScheme, mergedProfile);
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
      const finalAnswer = answer;
      session.lastAssistantAction = "focused";
      session.pendingQuestion = null;
      return respond({
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
        return respond({
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
      const finalAnswer = answer;
      session.lastAssistantAction = "focused";
      session.pendingQuestion = null;
      return respond({
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
});
