import "dotenv/config";
import type { HttpFunction } from "@google-cloud/functions-framework";
import cors from "cors";
import { CommentFetchError, record, syncAll, syncCampaign, validKey } from "./lib/comments";
import firebase from "./lib/firebase";
import Sentry from "./lib/sentry";

const corsHandler = cors({ origin: true });
export const processInstagramComments: HttpFunction = (req, res) => {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        res.status(405).json({ error: "Method not allowed" });
        return;
    }
    corsHandler(req, res, async () => {
        const id = req.query.campaign_id;
        if (id !== undefined && !validKey(id)) {
            res.status(400).json({ error: "campaign_id must be a valid single identifier" });
            return;
        }
        try {
            if (id !== undefined) {
                const campaign = record(
                    (await firebase.database().ref(`influencer_campaigns/${id}`).once("value")).val(),
                );
                if (!campaign) {
                    res.status(404).json({ error: "Campaign not found" });
                    return;
                }
                const counts = await syncCampaign(firebase, id, campaign);
                res.status(200).json(counts);
                return;
            }
            const counts = await syncAll(firebase);
            res.status(200).json(counts);
        } catch (error) {
            const sanitized = new Error(
                error instanceof CommentFetchError ? error.message : "Comment synchronization failed: storage",
            );
            Sentry.captureException(sanitized);
            await Sentry.flush(2000);
            res.status(500).json({ error: "Comment synchronization failed" });
        }
    });
};
