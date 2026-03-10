const { hasProfileSignal, getNextQuestion } = require("./profile");
const { inferSupportType } = require("./intent");

function titleCase(s) {
  return String(s || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Build an empathetic "which scheme" message that acknowledges the user,
 * shows transparency, and connects to what they said.
 */
function buildEmpatheticSchemePicker(profile, question, choiceSummaryText) {
  const parts = [];
  const location = profile.city
    ? `${titleCase(profile.city)}${profile.district ? `, ${titleCase(profile.district)}` : ""}`
    : profile.district
      ? titleCase(profile.district)
      : profile.state
        ? titleCase(profile.state)
        : null;

  // Acknowledge what they shared
  if (profile.category === "pwd" || /\b(disab|divyang|viklang|pwd)\b/i.test(question || "")) {
    parts.push("I understand you need support as a person with disability.");
  } else if (profile.profession) {
    parts.push(`I see you're a ${profile.profession}${location ? ` in ${location}` : ""}.`);
  } else if (location) {
    parts.push(`I see you're from ${location}.`);
  } else {
    parts.push("Based on what you shared,");
  }

  // Transparent: what we did
  parts.push("I found these schemes that may help you:\n");
  parts.push(choiceSummaryText);
  parts.push("\nWhich one would you like to know more about? You can reply with the number (1, 2, 3, 4) or the scheme name.");
  return parts.join(" ");
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
    base = `Want details for ${selectedScheme}? Ask for documents, apply link, or office address.`;
  } else if (hasProfile) {
    base = "What next? Find schemes, compare two, or get details of one.";
  } else {
    base = "Share your state and need—e.g. Maharashtra, scholarship.";
  }
  return toUserLanguage(base);
}

async function buildPendingClarifier(session, toUserLanguage) {
  if (session.pendingQuestion) {
    return toUserLanguage(session.pendingQuestion);
  }
  return toUserLanguage("What would you like help with?");
}

async function buildPurposeGuidance(toUserLanguage) {
  return toUserLanguage(
    "I help with government schemes. Share your state and need—e.g. 'Maharashtra, scholarship' or 'Bihar, farmer loan'."
  );
}

async function buildOutOfScopeGuidance(toUserLanguage, profile = null) {
  const next =
    profile && hasProfileSignal(profile)
      ? "To continue, tell me your need (e.g. scholarship, pension, loan)."
      : "Share your state and need (e.g. scholarship, pension, business).";
  return toUserLanguage(`I only help with government schemes. ${next}`);
}

async function buildContextualGuidance(question, profile, toUserLanguage) {
  const supportType = inferSupportType(question);
  if (supportType === "exam_support") {
    if (!profile.state) {
      return toUserLanguage("For UPSC/exam schemes, tell me your state first.");
    }
    return toUserLanguage("Your category and income? I'll find exam/coaching schemes.");
  }

  return buildPurposeGuidance(toUserLanguage);
}

async function buildProgressClarifier(profile, toUserLanguage) {
  const summary = [];
  if (profile.age != null) summary.push(`age ${profile.age}`);
  if (profile.profession) summary.push(profile.profession);
  if (profile.incomeAnnual != null) summary.push(`income ₹${profile.incomeAnnual}`);
  if (profile.category) summary.push(profile.category);
  if (profile.state) summary.push(profile.state);
  if (profile.landAcres != null) summary.push(`${profile.landAcres} acres`);

  const nextQuestion = getNextQuestion(profile);
  if (!nextQuestion) {
    return toUserLanguage("What type of schemes? (scholarship, pension, farmer, business)");
  }

  if (summary.length === 0) return toUserLanguage(nextQuestion);
  return toUserLanguage(`Got it (${summary.join(", ")}). ${nextQuestion}`);
}

module.exports = {
  buildSmalltalkClarifier,
  buildPendingClarifier,
  buildPurposeGuidance,
  buildOutOfScopeGuidance,
  buildContextualGuidance,
  buildProgressClarifier,
  buildEmpatheticSchemePicker,
};
