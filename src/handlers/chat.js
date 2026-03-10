const { runAgentTurn } = require("../services/agent");
const { executeSearchSchemesTool } = require("./chat/toolExecutor");

function createChatHandler({ getSession, runWithRetry, geographyService }) {
  return async function chatHandler(req, res) {
    try {
      const { question, language = "en", sessionId: sessionIdInput } = req.body;

      const { sessionId, session, sessionIdProvided } = getSession(sessionIdInput, req.user?.id || null);

      // Initialize conversation history if it doesn't exist
      if (!session.conversationHistory) {
        session.conversationHistory = [];
      }

      // Pre-process geography from user input to help the LLM with district->state mapping
      const extractedLocation = await runWithRetry(() => geographyService.extractFromText(question), {
        timeoutMs: 15000,
        retries: 1,
        label: "geo_extraction"
      });

      if (extractedLocation && (extractedLocation.state || extractedLocation.district)) {
        if (!session.profile) session.profile = {};
        if (extractedLocation.state) session.profile.state = extractedLocation.state;
        if (extractedLocation.district) session.profile.district = extractedLocation.district;
      }

      // Push the new user message
      session.conversationHistory.push({ role: "user", content: question });

      // Run the first agent turn
      let assistantMessage = await runWithRetry(() => runAgentTurn(session.conversationHistory, session), { timeoutMs: 30000, retries: 1, label: "agent_turn_1" });

      // Handle tool calls
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        // Push the assistant's tool call request to history so the LLM knows what it did
        session.conversationHistory.push(assistantMessage);

        for (const toolCall of assistantMessage.tool_calls) {
          if (toolCall.function.name === "search_schemes") {
            const args = JSON.parse(toolCall.function.arguments);

            // Merge the LLM-extracted profile into our session state
            session.profile = { ...(session.profile || {}), ...(args.profile || {}) };
            if (args.intent === 'details' && session.lastMatches) {
              // If details are requested, pass current matches so LLM can focus. Done implicitly via tool!
            }

            // Execute the tool
            const toolResult = await executeSearchSchemesTool({ args, runWithRetry, geographyService });

            // Save raw matches to session for future turns
            session.lastMatches = toolResult.rawMatchesSubset;

            // Push the tool result back to the LLM
            session.conversationHistory.push({
              role: "tool",
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: JSON.stringify(toolResult.toolResponse)
            });
          }
        }

        // Run the agent again to get the final text response now that it has the tool data
        assistantMessage = await runWithRetry(() => runAgentTurn(session.conversationHistory, session), { timeoutMs: 30000, retries: 1, label: "agent_turn_2" });
      }

      // Final response
      const finalAnswer = assistantMessage.content || "I'm having trouble understanding right now. Could you please rephrase?";

      // Push the final assistant answer to history
      session.conversationHistory.push({ role: "assistant", content: finalAnswer });

      // Keep history manageable (last 10 messages)
      if (session.conversationHistory.length > 10) {
        session.conversationHistory = session.conversationHistory.slice(-10);
      }

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

      return respond({
        memory: session.profile || {},
        answer: finalAnswer,
        matches: session.lastMatches || []
      });

    } catch (err) {
      const log = req.log;
      if (log) {
        log.error({ err: err?.message, stack: err?.stack }, "CHAT_HANDLER_ERROR");
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  };
}

module.exports = {
  createChatHandler,
};
