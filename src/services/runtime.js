async function runWithRetry(task, { timeoutMs = 12000, retries = 1, label = "task" } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await Promise.race([
        task(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs)),
      ]);
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, 150 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

module.exports = {
  runWithRetry,
};
