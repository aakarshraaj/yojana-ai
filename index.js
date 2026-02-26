require("dotenv").config();
const express = require("express");
const { generateEmbedding, generateChatResponse } = require("./lib/openai");
const { searchSchemes } = require("./lib/supabase");

const requiredEnv = ['OPENAI_API_KEY', 'SUPABASE_URL', 'SUPABASE_KEY'];
const missingEnv = requiredEnv.filter(k => !process.env[k]);
if (missingEnv.length) {
  console.error('Missing required env vars:', missingEnv.join(', '));
  console.error('Check your .env or environment and restart the server.');
}

const app = express();
app.use(express.json({ limit: "1mb" }));

/**
 * Health check
 */
app.get("/", (req, res) => {
  res.json({ status: "yojana-ai running" });
});

/**
 * Chat endpoint
 */
app.post("/chat", async (req, res) => {
  try {
    const { question } = req.body;

    if (!question || question.trim().length === 0) {
      return res.status(400).json({
        error: "Question is required",
      });
    }

    console.log("\n-----------------------------------");
    console.log("User question:", question);

    /**
     * 1️⃣ Generate embedding for question
     */
    const embedding = await generateEmbedding(question);
    console.log("Embedding produced. length:", Array.isArray(embedding) ? embedding.length : typeof embedding);

    /**
     * 2️⃣ Search vector database
     */
    const matches = await searchSchemes(embedding);
    console.log("Matches returned:", Array.isArray(matches) ? matches.length : typeof matches);

    if (!matches || matches.length === 0) {
      return res.json({
        answer:
          "I couldn’t find relevant schemes. Please try being more specific (state, profession, income group, etc).",
        matches: [],
      });
    }

    console.log("Top matches:");
    matches.forEach(m =>
      console.log(`- ${m.name} (${m.similarity.toFixed(3)})`)
    );

    /**
     * 3️⃣ Build STRONG structured context
     */
    const context = matches.map((m, index) => {
      let raw = m.raw_json?.data?.en || {};

      let description =
        raw.schemeContent?.briefDescription ||
        raw.schemeContent?.schemeContent ||
        "";

      let eligibility =
        raw.eligibilityCriteria?.eligibilityDescription_md ||
        raw.eligibilityCriteria?.description ||
        "";

      let benefits =
        raw.schemeBenefits?.benefits ||
        raw.schemeBenefits?.description ||
        "";

      // Ensure strings
      if (typeof description !== "string")
        description = JSON.stringify(description);
      if (typeof eligibility !== "string")
        eligibility = JSON.stringify(eligibility);
      if (typeof benefits !== "string")
        benefits = JSON.stringify(benefits);

      // Trim to avoid token overload
      description = description.slice(0, 800);
      eligibility = eligibility.slice(0, 500);
      benefits = benefits.slice(0, 500);

      return `
Scheme ${index + 1}:
Name: ${m.name}
Relevance Score: ${m.similarity.toFixed(2)}

Description:
${description}

Eligibility:
${eligibility}

Benefits:
${benefits}
`;
    }).join("\n");

    /**
     * 4️⃣ Generate AI response
     */
    const answer = await generateChatResponse(question, context);

    return res.json({
      answer,
      matches: matches.map(m => ({
        name: m.name,
        similarity: m.similarity,
      })),
    });

  } catch (err) {
    console.error("FULL ERROR DUMP:");
    console.error(err && err.stack ? err.stack : err);

    const payload = { error: err && err.message ? err.message : "Internal server error" };
    if (process.env.NODE_ENV === 'development') payload.details = err && err.stack ? err.stack : null;

    return res.status(500).json(payload);
  }
});

/**
 * Railway dynamic port or fallback
 */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n🚀 Yojana AI running on port ${PORT}`);
});