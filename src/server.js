require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { parseStructuredInput, formatStructuredOutput } = require("../lib/openai");
const { verifyAccessToken, getSupabaseClient } = require("../lib/supabase");
const { validateChatRequest, validateParseRequest } = require("./middleware/validation");
const { createSessionManager } = require("./services/session");
const { runWithRetry } = require("./services/runtime");
const { fallbackParse, normalizeParseResponse } = require("./services/parse");
const { createChatHandler } = require("./handlers/chat");
const { GeographyService } = require("./services/geography");
const { createProfileService } = require("./services/profile");

const requiredEnv = ["OPENAI_API_KEY", "SUPABASE_URL", "SUPABASE_KEY"];
const missingEnv = requiredEnv.filter((k) => !process.env[k]);
if (missingEnv.length) {
  console.error("Missing required env vars:", missingEnv.join(", "));
  process.exit(1);
}

const allowedOrigins = (
  process.env.ALLOWED_ORIGINS ||
  "http://localhost:3000,https://yojana-web-production.up.railway.app"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const app = express();
app.set("trust proxy", true);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("CORS blocked"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.json({ status: "yojana-ai running" });
});

const sessionManager = createSessionManager({
  ttlMs: Number(process.env.SESSION_TTL_MS || 1000 * 60 * 60 * 24),
  maxSessions: 5000,
});

const geographyService = new GeographyService(getSupabaseClient());
const profileService = createProfileService({ geographyService });

app.get("/geo/states", async (req, res) => {
  try {
    const states = await geographyService.getAllStates();
    return res.json({ states });
  } catch (err) {
    console.error("GEO STATES ERROR:", err?.stack || err);
    return res.status(500).json({ error: "Failed to fetch states" });
  }
});

app.get("/geo/districts", async (req, res) => {
  try {
    const state = String(req.query.state || "").trim();
    if (!state) return res.status(400).json({ error: "Query param 'state' is required" });
    const districts = await geographyService.getDistrictsByState(state);
    return res.json({ state: state.toLowerCase(), districts });
  } catch (err) {
    console.error("GEO DISTRICTS ERROR:", err?.stack || err);
    return res.status(500).json({ error: "Failed to fetch districts" });
  }
});

app.get("/geo/resolve", async (req, res) => {
  try {
    const text = String(req.query.text || "").trim();
    if (!text) return res.status(400).json({ error: "Query param 'text' is required" });
    const location = await geographyService.extractFromText(text);
    return res.json({ location });
  } catch (err) {
    console.error("GEO RESOLVE ERROR:", err?.stack || err);
    return res.status(500).json({ error: "Failed to resolve location" });
  }
});

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await verifyAccessToken(token);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    req.user = user;
    return next();
  } catch (_) {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

app.post("/parse", validateParseRequest, async (req, res) => {
  const { message, context = {} } = req.body || {};
  try {
    const parsed = await runWithRetry(() => parseStructuredInput(message, context), {
      timeoutMs: 8000,
      retries: 1,
      label: "parse",
    });
    return res.json(normalizeParseResponse(parsed));
  } catch (err) {
    console.error("PARSE ERROR:", err?.stack || err);
    return res.json(normalizeParseResponse(await fallbackParse(message, { profileService })));
  }
});

app.post("/format", async (req, res) => {
  try {
    const payload = req.body || {};
    const answer = await runWithRetry(() => formatStructuredOutput(payload), {
      timeoutMs: 8000,
      retries: 1,
      label: "format",
    });
    return res.json({ answer: String(answer || "").trim() || "No schemes found for this profile." });
  } catch (err) {
    console.error("FORMAT ERROR:", err?.stack || err);
    return res.json({ answer: "No schemes found for this profile." });
  }
});

app.post(
  "/chat",
  requireAuth,
  validateChatRequest,
  createChatHandler({
    getSession: sessionManager.getSession,
    runWithRetry,
    profileService,
    geographyService,
  })
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Yojana AI running on port ${PORT}`);
});

module.exports = app;
