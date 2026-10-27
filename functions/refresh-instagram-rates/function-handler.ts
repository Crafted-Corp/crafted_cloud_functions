import "dotenv/config";
import type { HttpFunction, Response } from "@google-cloud/functions-framework";
import cors from "cors";
import type * as admin from "firebase-admin";
import firebase from "./lib/firebase";
import { processUserInstagramRate } from "./lib/instagram-rates";
import Sentry from "./lib/sentry";
import type { RateOutcome, UserRecord } from "./lib/types";

const BATCH_SIZE_USERS = 100;

const corsHandler = cors({ origin: true });

interface RunCounts {
    processed: number;
    skipped: number;
    failed: number;
}

const isUserMap = (value: unknown): value is Record<string, UserRecord> => typeof value === "object" && value !== null;

const processOrFail = async (app: admin.app.App, creatorId: string, user: UserRecord): Promise<RateOutcome> => {
    try {
        return await processUserInstagramRate(app, creatorId, user);
    } catch (error) {
        console.error(`[ERROR] Failed to process user ${creatorId}:`, error);
        return { outcome: "failed" };
    }
};

const refreshAllUsers = async (app: admin.app.App): Promise<RunCounts> => {
    const usersRef = app.database().ref("users");
    const counts: RunCounts = { processed: 0, skipped: 0, failed: 0 };
    let lastKey: string | null = null;

    for (;;) {
        let query = usersRef.orderByKey().limitToFirst(BATCH_SIZE_USERS);
        if (lastKey) {
            query = query.startAfter(lastKey);
        }
        const users: unknown = (await query.once("value")).val();
        if (!isUserMap(users) || Object.keys(users).length === 0) {
            console.log("[INFO] No more users found in this batch");
            break;
        }

        const userKeys = Object.keys(users);
        lastKey = userKeys[userKeys.length - 1];
        console.log(`[INFO] Processing batch with ${userKeys.length} users`);
        const outcomes = await Promise.all(userKeys.map((key) => processOrFail(app, key, users[key])));
        for (const result of outcomes) {
            counts[result.outcome] += 1;
        }
        if (userKeys.length < BATCH_SIZE_USERS) break;
    }
    return counts;
};

const refreshOneUser = async (app: admin.app.App, userId: string, res: Response): Promise<void> => {
    const user: unknown = (await app.database().ref("users").child(userId).once("value")).val();
    if (!isUserMap(user)) {
        console.warn(`[WARN] User ${userId} not found or is null.`);
        res.status(404).json({ status: "404", statuscode: "-1", message: `User ${userId} not found.` });
        return;
    }

    try {
        const result = await processUserInstagramRate(app, userId, user);
        if (result.outcome === "skipped") {
            res.status(200).json({
                status: "200",
                statuscode: "1",
                message: `User ${userId} skipped: ${result.reason}`,
            });
            return;
        }
        console.log(`[SUCCESS] Processed Instagram rate for user ${userId}`);
        res.status(200).json({
            status: "200",
            statuscode: "1",
            message: `Successfully updated Instagram rate for user ${userId}`,
            suggestedRate: result.suggestedRate,
        });
    } catch (error) {
        console.error(`[ERROR] Failed processing user ${userId}:`, error);
        res.status(500).json({ status: "500", statuscode: "-1", message: `Failed to process user ${userId}.` });
    }
};

const refreshInstagramRates: HttpFunction = (req, res) => {
    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        res.status(405).json({ status: "405", statuscode: "-1", message: "Method not allowed" });
        return;
    }

    corsHandler(req, res, async () => {
        try {
            const startedAt = Date.now();
            console.log("[INFO] Starting Instagram rates refresh process");

            const userId = req.query.user_id;
            if (userId !== undefined) {
                if (typeof userId !== "string" || userId === "") {
                    return res.status(400).json({
                        status: "400",
                        statuscode: "-1",
                        message: "user_id must be a single non-empty value.",
                    });
                }
                return await refreshOneUser(firebase, userId, res);
            }

            const counts = await refreshAllUsers(firebase);
            console.log(
                `[INFO] refresh-instagram-rates finished: processed=${counts.processed} skipped=${counts.skipped} failed=${counts.failed} ms=${Date.now() - startedAt}`,
            );
            return res.status(200).json({
                status: "200",
                statuscode: "1",
                message: "Refreshed all Instagram accounts successfully",
                ...counts,
            });
        } catch (error) {
            Sentry.captureException(error);
            console.error("[ERROR] Error refreshing Instagram accounts:", error);
            return res.status(500).json({
                status: "500",
                statuscode: "-1",
                message: "Error refreshing Instagram accounts.",
            });
        }
    });
};

export { refreshInstagramRates };
