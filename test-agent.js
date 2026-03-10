require("dotenv").config();
const { runAgentTurn } = require("./src/services/agent");
const { executeSearchSchemesTool } = require("./src/handlers/chat/toolExecutor");
const { GeographyService } = require("./src/services/geography");
const { getSupabaseClient } = require("./lib/supabase");
const { runWithRetry } = require("./src/services/runtime");

async function test() {
    console.log("Testing full cycle...");
    const history = [{ role: "user", content: "bro i'm a low income 47 year old, planning s small business in westbengal" }];
    const session = { profile: {} };

    const firstMsg = await runAgentTurn(history, session);
    console.log("Turn 1:", JSON.stringify(firstMsg, null, 2));

    if (firstMsg.tool_calls && firstMsg.tool_calls.length > 0) {
        history.push(firstMsg);
        for (const tc of firstMsg.tool_calls) {
            const args = JSON.parse(tc.function.arguments);
            session.profile = { ...(session.profile || {}), ...(args.profile || {}) };

            const toolResult = await executeSearchSchemesTool({
                args,
                runWithRetry: runWithRetry || (async (fn) => fn()),
                geographyService: new GeographyService(getSupabaseClient())
            });

            console.log("Tool Result Matches:", toolResult.toolResponse.results.length);
            history.push({
                role: "tool",
                tool_call_id: tc.id,
                name: tc.function.name,
                content: JSON.stringify(toolResult.toolResponse)
            });
        }

        const finalMsg = await runAgentTurn(history, session);
        console.log("Final turn:", finalMsg);
    }
}

test().catch(err => {
    console.error("CAUGHT ERROR:", err.stack);
});
