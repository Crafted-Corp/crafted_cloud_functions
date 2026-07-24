import * as functions from "@google-cloud/functions-framework";
import { creatorOutreach } from "./function-handler";

// Canonical target name for this function is "creator-outreach" (kebab-case,
// matching the directory). The registered target here, the gcloud
// `--entry-point`, and the deployed function name MUST all be this same string —
// a mismatch fails at cold start with "Function ... is not defined in the module".
functions.http("creator-outreach", creatorOutreach);
