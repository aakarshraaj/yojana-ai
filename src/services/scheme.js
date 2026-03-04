const { PROFESSION_KEYWORDS } = require("../config/geography");

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

function isCentralScheme(raw) {
  return /(pradhan mantri|pm-|government of india|ministry of|national scheme|centrally sponsored|all india|central government)/i.test(
    raw
  );
}

async function extractMentionedStates(raw, { geographyService = null } = {}) {
  if (!geographyService) return [];
  try {
    return await geographyService.extractMentionedStates(raw);
  } catch (_) {
    return [];
  }
}

async function scoreMatch(match, profile, { geographyService = null } = {}) {
  const corpus = `${String(match.name || "")} ${JSON.stringify(match.raw_json || "")}`;
  const lower = corpus.toLowerCase();
  const mentionedStates = await extractMentionedStates(corpus, { geographyService });
  let ruleScore = 0;
  let hardReject = false;

  if (profile.state) {
    if (lower.includes(profile.state)) ruleScore += 20;
    if (mentionedStates.length > 0 && !mentionedStates.includes(profile.state)) hardReject = true;
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

async function applyStateGuardrails(matches, profile, { geographyService = null } = {}) {
  const normalized = normalizeMatches(matches);
  if (!profile.state) {
    return { matches: normalized, droppedCount: 0, mismatchDetected: false };
  }

  let droppedCount = 0;
  const filtered = [];
  for (const m of normalized) {
    const corpus = `${String(m.name || "")} ${JSON.stringify(m.raw_json || "")}`;
    const mentionedStates = await extractMentionedStates(corpus, { geographyService });
    if (mentionedStates.length === 0) {
      if (isCentralScheme(corpus)) {
        filtered.push(m);
        continue;
      }
      droppedCount += 1;
      continue;
    }
    if (mentionedStates.includes(profile.state)) {
      filtered.push(m);
      continue;
    }
    droppedCount += 1;
  }

  return {
    matches: filtered,
    droppedCount,
    mismatchDetected: droppedCount > 0,
  };
}

async function rankMatches(matches, profile, { geographyService = null } = {}) {
  const scored = await Promise.all(
    normalizeMatches(matches).map((m) => scoreMatch(m, profile, { geographyService }))
  );
  const keep = scored.filter((m) => !m.hardReject);
  const base = keep.length > 0 ? keep : scored;
  return base.sort((a, b) => b.finalScore - a.finalScore).slice(0, 5);
}

function extractLinks(rawJson) {
  const text = JSON.stringify(rawJson || "");
  const links = text.match(/https?:\/\/[^\s"\\]+/g) || [];
  return [...new Set(links)].slice(0, 5);
}

function extractSchemeSections(match) {
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

  return {
    description,
    eligibility,
    benefits,
    documents,
    applyOnline,
    applyOffline,
    contact,
    links: extractLinks(raw),
  };
}

function buildFocusedContext(match) {
  const sections = extractSchemeSections(match);
  const links = sections.links.join("\n") || "Not found";

  return `Focused Scheme Detail
Name: ${match.name}
Eligibility Probability: ${match.eligibilityProbability || "N/A"}%

Description:
${sections.description.slice(0, 1000)}

Eligibility:
${sections.eligibility.slice(0, 1000)}

Benefits:
${sections.benefits.slice(0, 800)}

Documents Required:
${sections.documents.slice(0, 800) || "Not found"}

How To Apply Online:
${sections.applyOnline.slice(0, 800) || "Not found"}

How To Apply Offline:
${sections.applyOffline.slice(0, 800) || "Not found"}

Contact/Helpline:
${sections.contact.slice(0, 500) || "Not found"}

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

function buildContext(matches) {
  return matches
    .map((m, i) => {
      const sections = extractSchemeSections(m);
      return `\nScheme ${i + 1}\nName: ${m.name}\nSimilarity: ${m.similarity.toFixed(3)}\nEligibility Probability: ${m.eligibilityProbability}%\n\nDescription:\n${sections.description.slice(0, 700)}\n\nEligibility:\n${sections.eligibility.slice(0, 500)}\n\nBenefits:\n${sections.benefits.slice(0, 400)}\n`;
    })
    .join("\n---------------------------------\n");
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

function sanitizeAnswerWithMatches(answer, matches = []) {
  const text = String(answer || "").trim();
  if (!text) return text;
  if (!Array.isArray(matches) || matches.length === 0) return text;

  const cleaned = text
    .split(/\r?\n/)
    .filter((line) => !/^no schemes found\b/i.test(line.trim()))
    .join("\n")
    .trim();

  return cleaned || text;
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

  const embeddedDigit = lower.match(
    /\b(?:about|detail(?:s)?(?:\s+for)?|for|show|explain|describe|tell\s+me\s+about|give(?:\s+me)?(?:\s+details)?(?:\s+for)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i
  );
  if (embeddedDigit) {
    const n = Number(embeddedDigit[1]);
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

  const phraseOrdinals = new Map([
    ["first", 0],
    ["1st", 0],
    ["second", 1],
    ["2nd", 1],
    ["third", 2],
    ["3rd", 2],
    ["fourth", 3],
    ["4th", 3],
    ["fifth", 4],
    ["5th", 4],
  ]);
  for (const [word, idx] of phraseOrdinals.entries()) {
    if (
      new RegExp(
        `\\b(?:about|detail(?:s)?(?:\\s+for)?|for|show|explain|describe|tell\\s+me\\s+about|give(?:\\s+me)?(?:\\s+details)?(?:\\s+for)?)\\s+${word}\\b`,
        "i"
      ).test(lower)
    ) {
      return idx;
    }
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

module.exports = {
  normalizeMatches,
  normalizeText,
  tokenSet,
  isDetailIntent,
  isCompareIntent,
  isSelectionIntent,
  extractSelectionIndex,
  pickBySelectionIndex,
  choiceSummary,
  findCompareSchemes,
  findFocusedScheme,
  isCentralScheme,
  extractMentionedStates,
  scoreMatch,
  applyStateGuardrails,
  rankMatches,
  buildFocusedContext,
  buildCompareContext,
  buildDeterministicList,
  sanitizeAnswerWithMatches,
  buildContext,
};
