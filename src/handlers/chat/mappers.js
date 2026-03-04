function mapMatchBasic(match) {
  return {
    slug: match.slug || null,
    name: match.name,
    similarity: Number(match.similarity || 0),
  };
}

function mapMatchScored(match) {
  return {
    slug: match.slug || null,
    name: match.name,
    similarity: Number(match.similarity || 0),
    semanticScore: Number(Number(match.semanticScore || 0).toFixed(2)),
    ruleScore: Number(match.ruleScore || 0),
    finalScore: Number(Number(match.finalScore || 0).toFixed(2)),
    eligibilityProbability: Number(match.eligibilityProbability || 0),
  };
}

module.exports = {
  mapMatchBasic,
  mapMatchScored,
};
