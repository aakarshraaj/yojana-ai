const { randomUUID } = require("crypto");
const { childLogger } = require("../../lib/logger");

function requestIdMiddleware(req, res, next) {
  const requestId = req.headers["x-request-id"] || randomUUID();
  req.requestId = requestId;
  req.log = childLogger(req);
  res.setHeader("X-Request-Id", requestId);
  next();
}

module.exports = {
  requestIdMiddleware,
};
