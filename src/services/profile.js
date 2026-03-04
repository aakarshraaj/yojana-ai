const { PROFESSION_KEYWORDS, CATEGORY_KEYWORDS } = require("../config/geography");

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

function extractByKeywords(text, dict) {
  const lower = String(text || "").toLowerCase();
  for (const [key, keywords] of Object.entries(dict)) {
    if (keywords.some((kw) => lower.includes(kw))) return key;
  }
  return null;
}

function extractIncome(text) {
  if (
    /\b(no income|zero income|income is zero|without income|no earning|no earnings|no money|no cash|income nil)\b/i.test(
      text
    )
  ) {
    return 0;
  }

  const patterns = [
    /(?:income|salary|earning|annual income)[^\d]{0,20}(?:rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)(?:\s*(lakh|lakhs|lac|lacs|crore|crores|k|thousand))?/i,
    /(?:rs\.?|inr)\s*([\d,]+(?:\.\d+)?)(?:\s*(lakh|lakhs|lac|lacs|crore|crores|k|thousand))?/i,
  ];

  for (const p of patterns) {
    const m = String(text || "").match(p);
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
    const m = String(text || "").match(p);
    if (!m) continue;
    const age = Number(m[1]);
    if (Number.isFinite(age) && age >= 1 && age <= 120) return age;
  }
  return null;
}

function extractLandAcres(text) {
  const m = String(text || "").match(/(\d+(?:\.\d+)?)\s*(acre|acres|hectare|hectares|ha)\b/i);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  const unit = m[2].toLowerCase();
  if (unit === "hectare" || unit === "hectares" || unit === "ha") return Number((value * 2.47105).toFixed(2));
  return value;
}

function createProfileService({ geographyService = null } = {}) {
  async function extractLocation(text) {
    if (!geographyService) return { city: null, district: null, state: null };
    try {
      const resolved = await geographyService.extractFromText(text);
      return {
        city: resolved?.city || null,
        district: resolved?.district || null,
        state: resolved?.state || null,
      };
    } catch (_) {
      return { city: null, district: null, state: null };
    }
  }

  async function extractCity(text) {
    const location = await extractLocation(text);
    return location.city;
  }

  async function extractDistrict(text) {
    const location = await extractLocation(text);
    return location.district;
  }

  async function extractState(text) {
    const location = await extractLocation(text);
    return location.state;
  }

  async function extractProfile(question) {
    const location = await extractLocation(question);
    return {
      state: location.state,
      district: location.district,
      city: location.city,
      age: extractAge(question),
      profession: extractByKeywords(question, PROFESSION_KEYWORDS),
      category: extractByKeywords(question, CATEGORY_KEYWORDS),
      incomeAnnual: extractIncome(question),
      landAcres: extractLandAcres(question),
    };
  }

  return {
    extractLocation,
    extractCity,
    extractDistrict,
    extractState,
    extractProfile,
  };
}

function mergeProfile(oldProfile, newProfile) {
  return {
    state: newProfile.state || oldProfile.state || null,
    district: newProfile.district || oldProfile.district || null,
    city: newProfile.city || oldProfile.city || null,
    age: newProfile.age != null ? newProfile.age : oldProfile.age ?? null,
    profession: newProfile.profession || oldProfile.profession || null,
    category: newProfile.category || oldProfile.category || null,
    incomeAnnual: newProfile.incomeAnnual != null ? newProfile.incomeAnnual : oldProfile.incomeAnnual ?? null,
    landAcres: newProfile.landAcres != null ? newProfile.landAcres : oldProfile.landAcres ?? null,
  };
}

function detectProfileConflict(oldProfile, newProfile) {
  const checks = ["state", "district", "category", "profession", "incomeAnnual"];
  for (const field of checks) {
    const from = oldProfile?.[field];
    const to = newProfile?.[field];
    if (from != null && to != null && from !== to) {
      return { field, from, to };
    }
  }
  return null;
}

function parseLeadingDecision(text) {
  const raw = String(text || "").trim();
  const lower = raw.toLowerCase();
  if (!lower) return { decision: null, remainder: "" };

  const yesPatterns = [/^(yes|y|yeah|yep|sure|ok|okay|correct|right|haan|ha|ji|done)\b/i];
  for (const p of yesPatterns) {
    const m = raw.match(p);
    if (m) {
      return {
        decision: "yes",
        remainder: raw.slice(m[0].length).replace(/^[,\s.:;-]+/, "").trim(),
      };
    }
  }

  const noPatterns = [/^(no|n|nope|nah|not now|wrong|cancel|nahi|na)\b/i];
  for (const p of noPatterns) {
    const m = raw.match(p);
    if (m) {
      return {
        decision: "no",
        remainder: raw.slice(m[0].length).replace(/^[,\s.:;-]+/, "").trim(),
      };
    }
  }

  return { decision: null, remainder: raw };
}

function isAffirmativeText(text) {
  const t = String(text || "").trim().toLowerCase();
  return /^(yes|y|yeah|yep|sure|ok|okay|correct|right|haan|ha|ji|yes please|done)$/i.test(t);
}

function isNegativeText(text) {
  const t = String(text || "").trim().toLowerCase();
  return /^(no|n|nope|nah|not now|wrong|cancel|nahi|na)$/i.test(t);
}

function isUndoProfileChangeCommand(text) {
  return /\b(undo profile change|undo last change|revert profile change|undo state change)\b/i.test(
    String(text || "")
  );
}

function profileText(profile) {
  const fields = [];
  if (profile.state) fields.push(`State: ${profile.state}`);
  if (profile.district) fields.push(`District: ${profile.district}`);
  if (profile.city) fields.push(`City: ${profile.city}`);
  if (profile.age != null) fields.push(`Age: ${profile.age}`);
  if (profile.profession) fields.push(`Profession: ${profile.profession}`);
  if (profile.category) fields.push(`Category: ${profile.category}`);
  if (profile.incomeAnnual != null) fields.push(`Annual income INR: ${profile.incomeAnnual}`);
  if (profile.landAcres != null) fields.push(`Land acres: ${profile.landAcres}`);
  return fields.join(" | ") || "No profile captured";
}

function hasProfileSignal(profile) {
  return !!(
    profile.state ||
    profile.district ||
    profile.city ||
    profile.profession ||
    profile.category ||
    profile.incomeAnnual != null ||
    profile.landAcres != null
  );
}

function getNextQuestion(profile) {
  if (!profile.state) return "Which state do you live in?";
  if (!profile.district) return "Which district do you live in?";
  if (profile.age == null) return "What is your age?";
  if (!profile.profession) return "What is your profession (farmer, student, worker, entrepreneur)?";
  if (profile.profession === "farmer" && profile.landAcres == null) return "How many acres of land do you own?";
  if (profile.incomeAnnual == null) return "What is your annual household income in INR?";
  if (!profile.category) return "What is your social category (SC, ST, OBC, EWS, minority, or general)?";
  return null;
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

const defaultProfileService = createProfileService();

module.exports = {
  createProfileService,
  extractLocation: defaultProfileService.extractLocation,
  extractCity: defaultProfileService.extractCity,
  extractDistrict: defaultProfileService.extractDistrict,
  extractState: defaultProfileService.extractState,
  extractProfile: defaultProfileService.extractProfile,
  mergeProfile,
  detectProfileConflict,
  parseLeadingDecision,
  isAffirmativeText,
  isNegativeText,
  isUndoProfileChangeCommand,
  profileText,
  hasProfileSignal,
  getNextQuestion,
  detectBlankProfileTemplate,
  isResetCommand,
  isDisengageText,
};
