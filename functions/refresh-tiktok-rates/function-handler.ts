import "dotenv/config";
import type { HttpFunction } from "@google-cloud/functions-framework";
import cors from "cors";
import type * as admin from "firebase-admin";
import firebase from "./lib/firebase";
import Sentry from "./lib/sentry";
import { getSuggestedRateTikTok } from "./lib/tiktok-rates";
import type { RateOutcome, UserRecord } from "./lib/types";

const BATCH_SIZE_USERS = 100;
const CONCURRENCY = 5;

const corsHandler = cors({ origin: true });

type RunCounts = Record<RateOutcome, number>;

const isUserMap = (value: unknown): value is Record<string, UserRecord> => typeof value === "object" && value !== null;

const processBatch = async (
    app: admin.app.App,
    users: Record<string, UserRecord>,
    keys: string[],
    counts: RunCounts,
): Promise<void> => {
    for (let i = 0; i < keys.length; i += CONCURRENCY) {
        const results = await Promise.all(
            keys.slice(i, i + CONCURRENCY).map((key) => getSuggestedRateTikTok(app, key, users[key])),
        );
        for (const result of results) {
            counts[result] += 1;
        }
    }
};

const refreshAllUsers = async (app: admin.app.App, counts: RunCounts): Promise<void> => {
    const usersRef = app.database().ref("users");
    let lastKey: string | null = null;
    for (;;) {
        let query = usersRef.orderByKey().limitToFirst(BATCH_SIZE_USERS);
        if (lastKey) query = query.startAfter(lastKey);
        const users: unknown = (await query.once("value")).val();
        const keys = isUserMap(users) ? Object.keys(users) : [];
        if (!isUserMap(users) || keys.length === 0) break;
        await processBatch(app, users, keys, counts);
        lastKey = keys[keys.length - 1];
        if (keys.length < BATCH_SIZE_USERS) break;
    }
};

const refreshTiktokRates: HttpFunction = (req, res) => {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        res.status(405).json({ message: "Method not allowed" });
        return;
    }

    corsHandler(req, res, async () => {
        try {
            const startedAt = Date.now();
            const counts: RunCounts = { processed: 0, skipped: 0, failed: 0 };
            const userId = req.query.user_id;
            if (userId === undefined) {
                await refreshAllUsers(firebase, counts);
            } else {
                if (typeof userId !== "string" || userId === "") {
                    return res.status(400).json({ message: "user_id must be a single non-empty value" });
                }
                const user: unknown = (await firebase.database().ref("users").child(userId).once("value")).val();
                if (!isUserMap(user)) return res.status(404).json({ message: "User not found" });
                await processBatch(firebase, { [userId]: user }, [userId], counts);
            }

            console.log(
                `[INFO] refresh-tiktok-rates finished: processed=${counts.processed} skipped=${counts.skipped} failed=${counts.failed} ms=${Date.now() - startedAt}`,
            );
            return res.status(200).json(counts);
        } catch (error) {
            Sentry.captureException(error);
            console.error("[ERROR] Failed reading users for TikTok rate refresh:", error);
            return res.status(500).json({ message: "Error updating suggested rates" });
        }
    });
};

export { refreshTiktokRates };
