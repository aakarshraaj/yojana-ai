function createRetrievalFlow({
  complaintHandler,
  compareHandler,
  focusedHandler,
  discoveryHandler,
} = {}) {
  const resolvedComplaintHandler =
    complaintHandler || require("./retrieval/complaint").handleComplaintCorrection;
  const resolvedCompareHandler =
    compareHandler || require("./retrieval/compare").handleCompareRequest;
  const resolvedFocusedHandler =
    focusedHandler || require("./retrieval/focused").maybeHandleFocusedFromHistory;
  const resolvedDiscoveryHandler =
    discoveryHandler || require("./retrieval/discovery").handleDiscoveryAndDetails;

  return async function handleRetrievalFlow(params) {
    const { intent } = params;

    if (intent === "complaint_correction") {
      return resolvedComplaintHandler(params);
    }

    if (intent === "compare_request") {
      return resolvedCompareHandler(params);
    }

    const focusedResponse = await resolvedFocusedHandler(params);
    if (focusedResponse) return focusedResponse;

    return resolvedDiscoveryHandler(params);
  };
}

let defaultFlow = null;
async function handleRetrievalFlow(params) {
  if (!defaultFlow) defaultFlow = createRetrievalFlow();
  return defaultFlow(params);
}

module.exports = {
  createRetrievalFlow,
  handleRetrievalFlow,
};
