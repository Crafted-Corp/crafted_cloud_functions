import * as functions from "@google-cloud/functions-framework";
import { refreshInstagramRates } from "./function-handler";

// The registered target MUST equal the gcloud `--entry-point`; the DEPLOYED name
// carries the env suffix (`refresh-instagram-rates-dev` / `-staging` / `-prod`).
functions.http("refresh-instagram-rates", refreshInstagramRates);
