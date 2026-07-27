import "dotenv/config";
import type { HttpFunction } from "@google-cloud/functions-framework";
import cors from "cors";
import type * as admin from "firebase-admin";
import type { BlastResults } from "./lib/email";
import { sendOutreachEmails } from "./lib/email";
import firebase from "./lib/firebase";
import { scanCreators } from "./lib/scanner";
import type { OutreachRequest } from "./lib/schemas";
import { outreachRequestSchema } from "./lib/schemas";
import Sentry from "./lib/sentry";

const corsHandler = cors({ origin: true });

const storeResults = async (
    firebase: admin.app.App,
    data: OutreachRequest,
    blastResults: BlastResults,
): Promise<void> => {
    if (data.product === "studio") {
        await firebase.database().ref(`tasks/${data.task.uid}/invites`).set(blastResults);
    } else {
        const updates: Record<string, BlastResults> = {};
        updates[`brands/${data.brand_id}/influencer_campaigns/${data.campaign_id}/invites`] = blastResults;
        updates[`influencer_campaigns/${data.campaign_id}/invites`] = blastResults;
        await firebase.database().ref().update(updates);
    }
};

const creatorOutreach: HttpFunction = (req, res) => {
    corsHandler(req, res, async () => {
        try {
            const parsed = outreachRequestSchema.safeParse(req.body);
            if (!parsed.success) {
                console.warn(
                    `creator-outreach: rejected ${req.body?.product ?? "unknown"} request — ${parsed.error.errors.map((e) => e.message).join(", ")}`,
                );
                return res.status(400).json({
                    status: "400",
                    statuscode: "-1",
                    message: "Validation failed",
                    errors: parsed.error.errors.map((e) => e.message),
                });
            }
            const data = parsed.data;
            const target = data.product === "studio" ? `task=${data.task.uid}` : `campaign=${data.campaign_id}`;
            console.log(`creator-outreach: processing ${data.product} blast (brand=${data.brand_id} ${target})`);

            const matchingCreators = await scanCreators(firebase, data);

            const blastResults = await sendOutreachEmails(firebase, data, matchingCreators);

            await storeResults(firebase, data, blastResults);

            console.log(
                `creator-outreach: completed ${data.product} blast (brand=${data.brand_id} ${target}) — matched=${matchingCreators.length} sent=${blastResults.sent} failed=${blastResults.failed}`,
            );
            return res.status(200).json({
                status: "200",
                statuscode: "1",
                message: data.message || "",
                length: matchingCreators.length,
                data: matchingCreators,
                blastResults,
            });
        } catch (error) {
            Sentry.captureException(error);
            console.error("creator-outreach error:", error);
            return res.status(500).json({
                status: "500",
                statuscode: "-1",
                message: "An unexpected error occurred during creator outreach.",
            });
        }
    });
};

export { creatorOutreach };
