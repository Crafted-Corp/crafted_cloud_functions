const functions = require('@google-cloud/functions-framework');
const { refreshAllCampaignAnalytics } = require('./campaign');

functions.http('refreshAllCampaignAnalytics', refreshAllCampaignAnalytics);
