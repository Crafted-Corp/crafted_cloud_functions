const functions = require('@google-cloud/functions-framework');
const { insertCampaignDrafts } = require('./function_handler');

functions.http('insertCampaignDrafts', insertCampaignDrafts);

