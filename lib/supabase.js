require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET
);

async function searchSchemes(embedding) {
  const { data, error } = await supabase.rpc("match_schemes", {
    query_embedding: embedding,
    match_threshold: 0.70,
    match_count: 5,
  });

  if (error) {
    console.error("Vector search error:", error);
    throw error;
  }

  return data;
}

module.exports = { searchSchemes };