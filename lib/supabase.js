require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const RETRY_DELAYS_MS = [250, 700, 1500];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function searchSchemes(embedding) {
  const thresholds = [0.5, 0.35, 0.2, 0.0];

  for (const threshold of thresholds) {
    let lastError = null;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      const { data, error } = await supabase.rpc("match_schemes", {
        query_embedding: embedding,
        match_threshold: threshold,
        match_count: 15,
      });

      if (!error) {
        const matches = data || [];
        console.log(`Vector search threshold ${threshold}: ${matches.length} matches`);
        if (matches.length > 0) return matches;
        break;
      }

      lastError = error;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay != null) {
        await sleep(delay);
      }
    }

    if (lastError) {
      console.error("Vector search error:", lastError);
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

module.exports = { searchSchemes, verifyAccessToken };
