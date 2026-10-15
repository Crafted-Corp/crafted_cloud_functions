// Standalone deploy copies: refreshTokens, refreshInstagramRates, updateInstagramDemographics,
// processInstagramComments and refreshAllCampaignAnalytics.
const graphHostFor = (instagramNode) =>
  instagramNode?.api_path === "instagram" ? "https://graph.instagram.com/v24.0" : "https://graph.facebook.com/v24.0";
module.exports = { graphHostFor };
