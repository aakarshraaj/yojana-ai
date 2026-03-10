require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { logger } = require("../lib/logger");
const { requestIdMiddleware } = require("./middleware/requestId");
const { parseStructuredInput, formatStructuredOutput } = require("../lib/openai");
const { verifyAccessToken, getSupabaseClient } = require("../lib/supabase");
const { validateChatRequest, validateParseRequest } = require("./middleware/validation");
const { createSessionManager } = require("./services/session");
const { runWithRetry } = require("./services/runtime");
const { fallbackParse, normalizeParseResponse } = require("./services/parse");
const { createChatHandler } = require("./handlers/chat");
const { GeographyService } = require("./services/geography");
const { createProfileService } = require("./services/profile");
const {
  SESSION_TTL_MS,
  MAX_SESSIONS,
  DEFAULT_PORT,
  TIMEOUT_PARSE_MS,
  TIMEOUT_FORMAT_MS,
} = require("./config/constants");

const requiredEnv = ["OPENAI_API_KEY", "SUPABASE_URL", "SUPABASE_KEY"];
const missingEnv = requiredEnv.filter((k) => !process.env[k]);
if (missingEnv.length) {
  logger.error({ missingEnv }, "Missing required env vars");
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
app.use(requestIdMiddleware);

app.get("/", (req, res) => {
  res.json({ status: "yojana-ai running" });
});

const sessionManager = createSessionManager({
  ttlMs: SESSION_TTL_MS,
  maxSessions: MAX_SESSIONS,
});

const geographyService = new GeographyService(getSupabaseClient());

// Warm up the cache asynchronously on boot so the first chat request isn't slow
geographyService.refreshCache().catch(err => {
  logger.warn({ err: err?.message }, "Failed to warm up geography cache on boot");
});

const profileService = createProfileService({ geographyService });

app.get("/geo/states", async (req, res) => {
  const log = req.log || logger;
  try {
    const states = await geographyService.getAllStates();
    return res.json({ states });
  } catch (err) {
    log.error({ err: err?.message, stack: err?.stack }, "GEO_STATES_ERROR");
    return res.status(500).json({ error: "Failed to fetch states" });
  }
});

app.get("/geo/districts", async (req, res) => {
  const log = req.log || logger;
  try {
    const state = String(req.query.state || "").trim();
    if (!state) return res.status(400).json({ error: "Query param 'state' is required" });
    const districts = await geographyService.getDistrictsByState(state);
    return res.json({ state: state.toLowerCase(), districts });
  } catch (err) {
    log.error({ err: err?.message, stack: err?.stack }, "GEO_DISTRICTS_ERROR");
    return res.status(500).json({ error: "Failed to fetch districts" });
  }
});

app.get("/geo/resolve", async (req, res) => {
  const log = req.log || logger;
  try {
    const text = String(req.query.text || "").trim();
    if (!text) return res.status(400).json({ error: "Query param 'text' is required" });
    const location = await geographyService.extractFromText(text);
    return res.json({ location });
  } catch (err) {
    log.error({ err: err?.message, stack: err?.stack }, "GEO_RESOLVE_ERROR");
    return res.status(500).json({ error: "Failed to resolve location" });
  }
});

async function requireAuth(req, res, next) {
  const log = req.log || logger;
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      log.warn({ requestId: req.requestId }, "AUTH_MISSING_BEARER");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) {
      log.warn({ requestId: req.requestId }, "AUTH_EMPTY_TOKEN");
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await verifyAccessToken(token);
    if (!user) {
      log.warn({ requestId: req.requestId }, "AUTH_INVALID_TOKEN");
      return res.status(401).json({ error: "Unauthorized" });
    }

    req.user = user;
    return next();
  } catch (err) {
    log.error({ err: err?.message, requestId: req?.requestId }, "AUTH_ERROR");
    return res.status(401).json({ error: "Unauthorized" });
  }
}

app.post("/parse", validateParseRequest, async (req, res) => {
  const log = req.log || logger;
  const { message, context = {} } = req.body || {};
  try {
    const parsed = await runWithRetry(() => parseStructuredInput(message, context), {
      timeoutMs: TIMEOUT_PARSE_MS,
      retries: 1,
      label: "parse",
    });
    return res.json(normalizeParseResponse(parsed));
  } catch (err) {
    log.warn({ err: err?.message }, "PARSE_ERROR_using_fallback");
    return res.json(normalizeParseResponse(await fallbackParse(message, { profileService })));
  }
});

app.post("/format", async (req, res) => {
  const log = req.log || logger;
  try {
    const payload = req.body || {};
    const answer = await runWithRetry(() => formatStructuredOutput(payload), {
      timeoutMs: TIMEOUT_FORMAT_MS,
      retries: 1,
      label: "format",
    });
    return res.json({ answer: String(answer || "").trim() || "No schemes found for this profile." });
  } catch (err) {
    log.error({ err: err?.message }, "FORMAT_ERROR");
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

const PORT = process.env.PORT || DEFAULT_PORT;
app.listen(PORT, () => {
  logger.info({ port: PORT }, "Yojana AI started");
});

module.exports = app;
