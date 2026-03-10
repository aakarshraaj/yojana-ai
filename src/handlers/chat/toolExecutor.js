const { generateEmbedding } = require("../../../lib/openai");
const { searchSchemes } = require("../../../lib/supabase");
const { applyStateGuardrails, rankMatches, extractSchemeSections } = require("../../services/scheme");
const { TIMEOUT_EMBED_MS, TIMEOUT_SEARCH_MS } = require("../../config/constants");

async function executeSearchSchemesTool({ args, runWithRetry, geographyService }) {
    const { profile, intent, query } = args;

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

    const isDetails = intent === 'details';

    // Minimize matches so we don't blow up the LLM token limit on the return
    // If the intent is explicit detail finding, we can return more. But standard is 5.
    const summarizedMatches = matches.slice(0, isDetails ? 2 : 5).map(m => {
        const sections = extractSchemeSections(m);
        return {
            id: m.id,
            name: m.name,
            description: isDetails ? sections.description : sections.description.slice(0, 300) + (sections.description.length > 300 ? "..." : ""),
            eligibility: isDetails ? sections.eligibility : sections.eligibility.slice(0, 300) + (sections.eligibility.length > 300 ? "..." : ""),
            benefits: isDetails ? sections.benefits : sections.benefits.slice(0, 300) + (sections.benefits.length > 300 ? "..." : ""),
            process: isDetails ? m.process_md || "" : "",
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
