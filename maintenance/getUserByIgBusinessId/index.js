const functions = require('@google-cloud/functions-framework');
const { getUserByIgBusinessId } = require('./function_handler');

functions.http('getUserByIgBusinessId', getUserByIgBusinessId);

