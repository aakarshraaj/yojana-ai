const pino = require("pino");

const isProd = process.env.NODE_ENV === "production";
const logLevel = process.env.LOG_LEVEL || "info";

const baseLogger = pino({
  level: logLevel,
  base: { name: "yojana-ai" },
});

/**
 * Create a child logger with request context (requestId).
 * Use in HTTP handlers when req is available.
 */
function childLogger(req) {
  const requestId = req?.requestId;
  if (!requestId) return baseLogger;
  return baseLogger.child({ requestId });
}

module.exports = {
  logger: baseLogger,
  childLogger,
};
