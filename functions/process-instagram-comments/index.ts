import * as functions from "@google-cloud/functions-framework";
import { processInstagramComments } from "./function-handler";

functions.http("process-instagram-comments", processInstagramComments);
