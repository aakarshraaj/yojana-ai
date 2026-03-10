const OpenAI = require("openai");

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const tools = [
    {
        type: "function",
        function: {
            name: "search_schemes",
            description: "Search the database for government schemes based on the user's extracted profile. Call this WHENEVER the user provides enough profile details (especially State and Need) to find schemes, or asks to see schemes, compare schemes, or get details on a specific scheme.",
            parameters: {
                type: "object",
                properties: {
                    profile: {
                        type: "object",
                        description: "The extracted user profile details to filter schemes by. Merge any new details from the user's latest message with what is already known in the session state.",
                        properties: {
                            state: { type: "string", description: "The Indian state the user lives in (e.g., 'Maharashtra', 'Bihar'). This is REQUIRED to search effectively." },
                            city: { type: "string" },
                            district: { type: "string" },
                            need: { type: "string", description: "The core need or category (e.g., 'scholarship', 'farmer loan', 'unemployment', 'health', 'business')." },
                            age: { type: "number" },
                            category: { type: "string", description: "Caste/Social category: 'sc', 'st', 'obc', 'general', 'pwd', 'minority'" },
                            profession: { type: "string", description: "E.g., 'farmer', 'student', 'weaver'" },
                            incomeAnnual: { type: "number", description: "Annual family income in INR." }
                        }
                    },
                    intent: {
                        type: "string",
                        enum: ["recommend", "compare", "details", "complaint_correction"],
                        description: "What the user wants to do with the schemes. Use 'recommend' for finding lists of schemes, 'compare' for comparing two schemes side-by-side, 'details' for an in-depth look at one scheme, and 'complaint_correction' if the user corrects a previous search mistake."
                    },
                    query: {
                        type: "string",
                        description: "The specific search string or scheme name they are looking for, if applicable."
                    }
                },
                required: ["profile", "intent"]
            }
        }
    }
];

function buildSystemPrompt(sessionContext) {
    const hasState = !!sessionContext?.profile?.state;

    let prompt = `You are Yojana AI, a warm, highly empathetic, and practical assistant for Indian government schemes.
Act like a patient, knowledgeable social worker. YOU MUST CONVERSE NATIVELY IN THE USER'S LANGUAGE.

CRITICAL TONE RULES:
1. Active Listening & Validation: Always start your response by acknowledging the emotional or practical weight of what the user shared (e.g., "I know looking for crop support can be stressful").
2. Conversational Reciprocity: Never sound like an interrogation. Soften requests for data with reasons (e.g., "To help me narrow down the best options for you, could you...")
3. Accessible Language: Keep sentences short, warm, and free of dense bureaucratic jargon.

CRITICAL OPERATIONAL RULES:
1. DO NOT INVENT SCHEMES: Always use the \`search_schemes\` tool to fetch real data before recommending ANY scheme. Never hallucinate scheme names or policies.
2. THE STATE REQUIREMENT: You cannot search for schemes reliably without knowing the user's State. If the user's State is completely unknown, you MUST ask them what state they live in before using the \`search_schemes\` tool.
3. USING THE TOOL: When the user provides enough profile details, or asks for schemes, use the \`search_schemes\` tool. Merge the data they just provided with the Known Profile below.
4. HANDLE EMPTY RESULTS WARMLY: If \`search_schemes\` returns empty results, reply warmly: "I couldn't find exact schemes for your profile in that state right now, but please don't lose hope. We can try adjusting your details like category or occupation to look for others."

CURRENT SESSION STATE:
- Known Profile So Far: ${JSON.stringify(sessionContext.profile || {})}
- Currently Discussed Scheme: ${sessionContext.selectedScheme?.name || "None"}
`;

    if (!hasState) {
        prompt += `\n[SYSTEM WARNING]: The user's State is currently UNKNOWN. You MUST warmly ask for their State before calling search_schemes! Include a validation statement first.`;
    }

    return prompt;
}

async function runAgentTurn(conversationHistory, sessionContext) {
    const messages = [
        { role: "system", content: buildSystemPrompt(sessionContext) },
        ...conversationHistory
    ];

    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.2,
        messages: messages,
        tools: tools,
        tool_choice: "auto"
    });

    return response.choices[0].message;
}

module.exports = {
    tools,
    buildSystemPrompt,
    runAgentTurn
};
