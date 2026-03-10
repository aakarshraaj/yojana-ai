const { generateEmbedding } = require("../../../lib/openai");
const { searchSchemes } = require("../../../lib/supabase");
const { applyStateGuardrails, rankMatches, extractSchemeSections } = require("../../services/scheme");
const { TIMEOUT_EMBED_MS, TIMEOUT_SEARCH_MS } = require("../../config/constants");

async function executeSearchSchemesTool({ args, runWithRetry, geographyService }) {
    const { profile, query } = args;

    // Create a search query based on what the tool gave us
    const searchQuery = query || `Schemes for ${profile?.state || "India"} ${profile?.need || ""} ${profile?.profession || ""}`.trim();

    const embedding = await runWithRetry(() => generateEmbedding(searchQuery), {
        timeoutMs: TIMEOUT_EMBED_MS,
        retries: 1,
        label: "embed"
    });

    const rawMatches = await runWithRetry(() => searchSchemes(embedding), {
        timeoutMs: TIMEOUT_SEARCH_MS,
        retries: 1,
        label: "search"
    });

    const guarded = await applyStateGuardrails(rawMatches, profile || {}, { geographyService });
    const matches = await rankMatches(guarded.matches, profile || {}, { geographyService });

    // Minimize matches so we don't blow up the LLM token limit on the return
    // If the intent is explicit detail finding, we can return more. But standard is 5.
    const summarizedMatches = matches.slice(0, 5).map(m => {
        const sections = extractSchemeSections(m);
        return {
            id: m.id,
            name: m.name,
            description: sections.description.slice(0, 300) + "...",
            eligibility: sections.eligibility.slice(0, 300) + "...",
            benefits: sections.benefits.slice(0, 300) + "...",
            state: m.state,
            links: sections.links
        };
    });

    return {
        toolResponse: {
            success: true,
            matchesFound: summarizedMatches.length,
            stateMismatchDetected: guarded.mismatchDetected,
            results: summarizedMatches,
        },
        rawMatchesSubset: matches.slice(0, 10) // We return this to save it into the session separate from the LLM prompt
    };
}

module.exports = { executeSearchSchemesTool };
