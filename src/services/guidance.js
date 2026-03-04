const { hasProfileSignal, getNextQuestion } = require("./profile");
const { inferSupportType } = require("./intent");

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
    base = "I can help with schemes. Share your state and what support you need (scholarship, pension, farmer, business, health).";
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
  const next =
    profile && hasProfileSignal(profile)
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
    return toUserLanguage("Thanks, I have enough profile details. Tell me what type of schemes you want (scholarship, pension, farmer, business, health)."
    );
  }

  if (summary.length === 0) return toUserLanguage(nextQuestion);
  return toUserLanguage(`Noted ${summary.join(", ")}. ${nextQuestion}`);
}

module.exports = {
  buildSmalltalkClarifier,
  buildPendingClarifier,
  buildPurposeGuidance,
  buildOutOfScopeGuidance,
  buildContextualGuidance,
  buildProgressClarifier,
};
