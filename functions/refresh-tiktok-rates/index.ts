import * as functions from "@google-cloud/functions-framework";
import { refreshTiktokRates } from "./function-handler";

// The registered target MUST equal the gcloud `--entry-point`; the DEPLOYED name
// carries the env suffix (`refresh-tiktok-rates-dev` / `-staging` / `-prod`).
functions.http("refresh-tiktok-rates", refreshTiktokRates);
