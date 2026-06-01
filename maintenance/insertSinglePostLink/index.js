const functions = require('@google-cloud/functions-framework');
const { insertSinglePostLink } = require('./function_handler');

functions.http('insertSinglePostLink', insertSinglePostLink);
