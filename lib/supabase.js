require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { logger } = require("./logger");
const {
  VECTOR_SEARCH_THRESHOLDS,
  VECTOR_MATCH_COUNT,
  VECTOR_RETRY_DELAYS_MS,
} = require("../src/config/constants");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchSchemes(embedding) {
  for (const threshold of VECTOR_SEARCH_THRESHOLDS) {
    let lastError = null;

    for (let attempt = 0; attempt <= VECTOR_RETRY_DELAYS_MS.length; attempt += 1) {
      const { data, error } = await supabase.rpc("match_schemes", {
        query_embedding: embedding,
        match_threshold: threshold,
        match_count: VECTOR_MATCH_COUNT,
      });

      if (!error) {
        const matches = data || [];
        logger.debug({ threshold, matchCount: matches.length }, "vector_search");
        if (matches.length > 0) return matches;
        break;
      }

      lastError = error;
      const delay = VECTOR_RETRY_DELAYS_MS[attempt];
      if (delay != null) {
        await sleep(delay);
      }
    }

    if (lastError) {
      logger.error({ err: lastError?.message, threshold }, "VECTOR_SEARCH_ERROR");
      throw lastError;
    }
  }

  return [];
}

async function verifyAccessToken(token) {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return null;
  }
  return data.user;
}

function getSupabaseClient() {
  return supabase;
}

module.exports = { searchSchemes, verifyAccessToken, getSupabaseClient };
