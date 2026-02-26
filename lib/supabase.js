require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function searchSchemes(embedding) {
  const thresholds = [0.5, 0.35, 0.2, 0.0];

  for (const threshold of thresholds) {
    const { data, error } = await supabase.rpc("match_schemes", {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: 15,
    });

    if (error) {
      console.error("Vector search error:", error);
      throw error;
    }

    const matches = data || [];
    console.log(`Vector search threshold ${threshold}: ${matches.length} matches`);
    if (matches.length > 0) {
      return matches;
    }
  }

  return [];
}

module.exports = { searchSchemes };
