import * as functions from "@google-cloud/functions-framework";
import { creatorOutreach } from "./function-handler";

// The registered target here MUST equal the gcloud `--entry-point` — both are
// the in-code name "creator-outreach" (kebab-case, matching the directory); a
// mismatch fails at cold start with "Function ... is not defined in the module".
// The DEPLOYED function name is intentionally different: all three environments
// share one GCP project and are isolated by name (`creator-outreach-dev` /
// `-staging` / `-prod`), so the deploy passes `--entry-point=creator-outreach`
// while naming the function `creator-outreach-<env>`. Do not add an env suffix here.
functions.http("creator-outreach", creatorOutreach);
