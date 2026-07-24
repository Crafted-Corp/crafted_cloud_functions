import { z } from "zod";

const studioSchema = z
    .object({
        product: z.literal("studio"),
        brand_id: z.string().min(1),
        message: z.string().default(""),
        task: z
            .object({
                id: z.string().optional(),
                uid: z.string(),
                name: z.string(),
                regions: z.array(z.object({ value: z.string() })).min(1),
                price: z.number().positive(),
                note1: z.string().optional(),
                note2: z.string().optional(),
                note3: z.string().optional(),
                brief_link: z.string().optional(),
            })
            .passthrough(),
    })
    .passthrough();

const amplifySchema = z
    .object({
        product: z.literal("amplify"),
        brand_id: z.string().min(1),
        message: z.string(),
        campaign_id: z.string().min(1),
        campaign_name: z.string().min(1),
        follower_count: z.array(z.number()).length(2),
        platforms: z.array(z.enum(["tiktok", "instagram"])).min(1),
        states: z.array(z.string()).min(1),
    })
    .passthrough();

export const outreachRequestSchema = z.discriminatedUnion("product", [studioSchema, amplifySchema]);

export type OutreachRequest = z.infer<typeof outreachRequestSchema>;
export type StudioOutreachRequest = z.infer<typeof studioSchema>;
export type AmplifyOutreachRequest = z.infer<typeof amplifySchema>;
