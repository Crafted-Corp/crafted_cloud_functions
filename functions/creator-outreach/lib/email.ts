/**
 * Email service — brand data fetch, Handlebars rendering, SendGrid bulk send.
 *
 * Brand data is fetched ONCE per request (not per-creator) and templates compile
 * at module load (cold start), not per-request.
 */

import fs from "node:fs";
import path from "node:path";
import sgMail from "@sendgrid/mail";
import type * as admin from "firebase-admin";
import Handlebars from "handlebars";
import type { MatchedCreator } from "./scanner";
import type { AmplifyOutreachRequest, OutreachRequest, StudioOutreachRequest } from "./schemas";

sgMail.setApiKey(process.env.SENDGRID_API_KEY as string);

const FROM = "Crafted <team@usecrafted.com>";

const studioTemplate = Handlebars.compile(
    fs.readFileSync(path.resolve(__dirname, "../templates/StudioBriefInvite.hbs"), "utf8"),
);
const amplifyTemplate = Handlebars.compile(
    fs.readFileSync(path.resolve(__dirname, "../templates/CampaignInviteInNetwork.hbs"), "utf8"),
);

export interface BlastResults {
    messages: string;
    sent: number;
    failed: number;
}

interface BrandData {
    brandName: string | null;
    brandEmail: string | null;
}

interface AdminPrices {
    creator_amplify_video_price: number;
}

interface EmailPersonalization {
    from: string;
    to: string;
    subject: string;
    html: string;
}

interface SendGridResponse {
    statusCode: number;
    headers: Record<string, string>;
}

type SendGridSendResult = Array<[SendGridResponse, unknown]>;

const fetchBrandData = async (firebase: admin.app.App, brandId: string): Promise<BrandData> => {
    const [brandNameSnap, brandEmailSnap] = await Promise.all([
        firebase.database().ref(`brands/${brandId}/brand_name`).once("value"),
        firebase.database().ref(`brands/${brandId}/email`).once("value"),
    ]);
    return { brandName: brandNameSnap.val(), brandEmail: brandEmailSnap.val() };
};

const fetchAdminPrices = async (firebase: admin.app.App): Promise<AdminPrices> => {
    const snap = await firebase.database().ref("admin/pricing").once("value");
    return snap.val();
};

export const extractResults = (result: SendGridSendResult, personalizationCount: number): BlastResults => {
    const successfulEmails = result.filter((r) => r[0].statusCode === 202);
    const messageIds = result
        .map((r) => r[0].headers["x-message-id"])
        .filter(Boolean)
        .join(",");

    return {
        messages: messageIds,
        sent: successfulEmails.length,
        failed: personalizationCount - successfulEmails.length,
    };
};

export const calculateAmplifySuggestedRate = (
    tiktokSuggestedRate: number | undefined,
    instagramSuggestedRate: number | undefined,
    amplifyVideoPriceCents: number,
): number =>
    Number.parseInt(String((tiktokSuggestedRate || 0) / 100 + (instagramSuggestedRate || 0) / 100), 10) +
    amplifyVideoPriceCents / 100;

const sendStudioEmails = async (
    firebase: admin.app.App,
    data: StudioOutreachRequest,
    creators: MatchedCreator[],
): Promise<BlastResults> => {
    const brand = await fetchBrandData(firebase, data.brand_id);

    const personalizations: EmailPersonalization[] = [];

    for (const creator of creators) {
        if (!creator.email) continue;

        const html = studioTemplate({
            name: creator?.shipping_details?.fullname ?? "",
            brand_name: brand.brandName || "",
            brand_email: brand.brandEmail || "",
            task_name: data.task.name || "",
            note1: data.task.note1 || "",
            note2: data.task.note2 || "",
            note3: data.task.note3 || "",
            brief_link: data.task.brief_link || "",
            price: (data.task.price / 100).toFixed(2),
        });

        personalizations.push({
            from: FROM,
            to: creator.email,
            subject: `You've been invited to ${brand.brandName}'s Studio brief!`,
            html,
        });
    }

    if (personalizations.length > 0) {
        // SendGrid types send() as resolving to a single [ClientResponse, {}] tuple, but with
        // isMultiple=true it actually resolves to an array of per-message [response, body] tuples.
        const result = (await sgMail.send(personalizations, true)) as unknown as SendGridSendResult;
        return extractResults(result, personalizations.length);
    }

    return { messages: "", sent: 0, failed: 0 };
};

const sendAmplifyEmails = async (
    firebase: admin.app.App,
    data: AmplifyOutreachRequest,
    creators: MatchedCreator[],
): Promise<BlastResults> => {
    const brand = await fetchBrandData(firebase, data.brand_id);
    const prices = await fetchAdminPrices(firebase);

    const personalizations: EmailPersonalization[] = [];

    for (const creator of creators) {
        if (!creator.email) continue;

        const tiktokSuggestedRate = creator?.creator_socials?.tiktok?.performance?.suggestedRate;
        const instagramSuggestedRate = creator?.creator_socials?.instagram?.suggested_rate;

        // Skip creators without any rate data
        if (!tiktokSuggestedRate && !instagramSuggestedRate) continue;

        const suggestedRate = calculateAmplifySuggestedRate(
            tiktokSuggestedRate,
            instagramSuggestedRate,
            prices.creator_amplify_video_price,
        );

        const html = amplifyTemplate({
            name: creator?.shipping_details?.fullname ?? "",
            brand_name: brand.brandName || "",
            brand_email: brand.brandEmail || "",
            message: data.message || "",
            campaign_name: data.campaign_name || "",
            suggested_rate: suggestedRate || 0,
        });

        personalizations.push({
            from: FROM,
            to: creator.email,
            subject: `You've been invited to ${brand.brandName}'s campaign!`,
            html,
        });
    }

    if (personalizations.length > 0) {
        // See sendStudioEmails: SendGrid's declared multiple-send return shape is inaccurate.
        const result = (await sgMail.send(personalizations, true)) as unknown as SendGridSendResult;
        return extractResults(result, personalizations.length);
    }

    return { messages: "", sent: 0, failed: 0 };
};

export const sendOutreachEmails = async (
    firebase: admin.app.App,
    data: OutreachRequest,
    creators: MatchedCreator[],
): Promise<BlastResults> => {
    if (data.product === "studio") return sendStudioEmails(firebase, data, creators);
    return sendAmplifyEmails(firebase, data, creators);
};
