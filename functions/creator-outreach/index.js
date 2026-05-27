const functions = require("@google-cloud/functions-framework");
const { creatorOutreach } = require("./function-handler");
functions.http("creatorOutreach", creatorOutreach);
