const OpenAI = require("openai");

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const tools = [
    {
        type: "function",
        function: {
            name: "search_schemes",
            description: "CRITICAL: Call this tool IMMEDIATELY if the user provides any piece of their profile (e.g., State, age, profession, caste). DO NOT ask follow up questions about their profile. Call this tool to perform a search first.",
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

function buildSystemPrompt(sessionContext, isIntro = true) {
    const hasState = !!sessionContext?.profile?.state;

    let prompt = `You are Yojana AI, a warm, highly empathetic, and practical assistant for Indian government schemes.
Act like a patient, knowledgeable social worker. YOU MUST CONVERSE NATIVELY IN THE USER'S LANGUAGE.

CRITICAL TONE RULES:
1. Active Listening & Validation: Always start your response by acknowledging the emotional or practical weight of what the user shared (e.g., "I know looking for crop support can be stressful").
2. Conversational Reciprocity: Never sound like an interrogation. Soften requests for data with reasons (e.g., "To help me narrow down the best options for you, could you...")
3. Accessible Language: Keep sentences short, warm, and free of dense bureaucratic jargon.

CRITICAL OPERATIONAL RULES:
1. DELIVER SCHEMES IMMEDIATELY: If the user provides ANY piece of information (State, age, profession, need, category), you MUST IMMEDIATELY use the \`search_schemes\` tool. DO NOT ask them for missing profile fields (like income, caste, etc.) before running a search. Give them results first!
2. NEVER INTERROGATE: If the user gives a short answer (e.g. "I'm SC", "list me all available"), update the profile and IMMEDIATELY use the \`search_schemes\` tool. DO NOT ask any follow-up questions.
3. DO NOT INVENT SCHEMES: Always use the \`search_schemes\` tool to fetch real data before recommending ANY scheme. Never hallucinate scheme names or policies.
4. HANDLE EMPTY RESULTS WARMLY: If \`search_schemes\` returns empty results, reply warmly: "I couldn't find exact schemes for your profile in that state right now, but please don't lose hope. We can try adjusting your details like category or occupation to look for others."
5. FORMATTING THE LIST: When \`search_schemes\` returns results, present them clearly:
    - Use Markdown lists with bold headings.
    - Keep descriptions very brief (1-2 sentences max).
    - Focus on the main benefits and eligibility.

CURRENT SESSION STATE:
- Known Profile So Far: ${JSON.stringify(sessionContext.profile || {})}
- Currently Discussed Scheme: ${sessionContext.selectedScheme?.name || "None"}
`;

    if (!hasState && sessionContext?.conversationState === "start") {
        prompt += `\n[SYSTEM WARNING]: The user's State is currently UNKNOWN. Try to warmly ask for their State alongside your initial response!`;
    }

    return prompt;
}

async function runAgentTurn(conversationHistory, sessionContext) {
    const isIntro = conversationHistory.length < 2;
    const messages = [
        { role: "system", content: buildSystemPrompt(sessionContext, isIntro) },
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
