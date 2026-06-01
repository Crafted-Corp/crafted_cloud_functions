const functions = require('@google-cloud/functions-framework');
const { insertInstagramUserIds } = require('./function_handler');

functions.http('insertInstagramUserIds', insertInstagramUserIds);

