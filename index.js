require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { generateEmbedding, generateChatResponse } = require("./lib/openai");
const { searchSchemes } = require("./lib/supabase");

/**
 * Validate required environment variables
 */
const requiredEnv = ["OPENAI_API_KEY", "SUPABASE_URL", "SUPABASE_KEY"];
const missingEnv = requiredEnv.filter((k) => !process.env[k]);

if (missingEnv.length) {
  console.error("Missing required env vars:", missingEnv.join(", "));
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

/**
 * Health check
 */
app.get("/", (req, res) => {
  res.json({ status: "yojana-ai running" });
});

/**
 * Utility: Extract state mention from question
 */
function extractStateFromQuestion(question) {
  const states = [
    "maharashtra",
    "gujarat",
    "karnataka",
    "rajasthan",
    "uttar pradesh",
    "madhya pradesh",
    "bihar",
    "meghalaya",
    "tamil nadu",
    "kerala",
    "punjab",
    "haryana",
  ];

  const lower = question.toLowerCase();
  return states.find((s) => lower.includes(s)) || null;
}

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

    console.log("\n------------------------------");
    console.log("User question:", question);

    /**
     * 1️⃣ Generate embedding
     */
    const embedding = await generateEmbedding(question);
    console.log("Embedding length:", embedding.length);

    /**
     * 2️⃣ Vector search
     */
    let matches = await searchSchemes(embedding);
    console.log("Matches returned:", matches.length);

    if (!matches || matches.length === 0) {
      return res.json({
        answer:
          "I couldn’t find relevant schemes. Please try being more specific (state, profession, income group, etc).",
        matches: [],
      });
    }

    /**
     * 3️⃣ Prioritize state-specific matches
     */
    const detectedState = extractStateFromQuestion(question);

   if (detectedState) {
  const stateFilteredMatches = matches.filter((m) => {
    const rawText = JSON.stringify(m.raw_json || "").toLowerCase();
    return rawText.includes(detectedState);
  });

  // If we found schemes specific to the detected state,
  // use ONLY those. Otherwise fallback to original matches.
  if (stateFilteredMatches.length > 0) {
    matches = stateFilteredMatches;
  }
}

    /**
     * 4️⃣ Build structured context for GPT
     */
    const context = matches
      .map((m, index) => {
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

        if (typeof description !== "string")
          description = JSON.stringify(description);
        if (typeof eligibility !== "string")
          eligibility = JSON.stringify(eligibility);
        if (typeof benefits !== "string")
          benefits = JSON.stringify(benefits);

        description = description.slice(0, 700);
        eligibility = eligibility.slice(0, 400);
        benefits = benefits.slice(0, 400);

        return `
Scheme ${index + 1}
Name: ${m.name}
Similarity Score: ${m.similarity.toFixed(2)}

Description:
${description}

Eligibility:
${eligibility}

Benefits:
${benefits}
`;
      })
      .join("\n---------------------------------\n");

    /**
     * 5️⃣ Generate AI response
     */
    const answer = await generateChatResponse(question, context);

    return res.json({
      answer,
      matches: matches.map((m) => ({
        name: m.name,
        similarity: m.similarity,
      })),
    });

  } catch (err) {
    console.error("FULL ERROR DUMP:");
    console.error(err?.stack || err);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
});

/**
 * Railway dynamic port
 */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Yojana AI running on port ${PORT}`);
});