const functions = require('@google-cloud/functions-framework');
const { insertCampaignProposalsDemographics } = require('./function_handler');

functions.http('insertCampaignProposalsDemographics', insertCampaignProposalsDemographics);

