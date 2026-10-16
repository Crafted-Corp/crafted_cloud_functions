import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { type Json, reset, writes } from "./firebaseStub.ts";

interface Post {
  platform: "instagram" | "tiktok";
  creator_id?: string;
  media_id?: string;
  short_link?: string;
}

interface Campaign {
  brand_id: string;
  status: string;
  tasks: Record<string, { posts: Record<string, Post> }>;
}

interface UtilsModule {
  processCampaignAnalytics(params: { campaign_id: string; campaign: Campaign; curDate: string }): Promise<void>;
}

interface HttpClient {
  get(url: string): Promise<never>;
  post(url: string): Promise<never>;
}

const CAMPAIGN_ID = "campaign-1";
const BRAND_ID = "brand-1";
const TASK_ID = "task-1";
const POST_ID = "post-1";
const POST_PERFORMANCE = `tasks/${TASK_ID}/posts/${POST_ID}/performance`;

const storedPerformance: Json = {
  "-existing": { likes: 1, comments: 2, shares: 3, views: 4, updated: "2026-10-01T00:00:00Z" },
};

process.env.PRODEV = fileURLToPath(new URL("./firebaseStub.ts", import.meta.url));
const requireFromTest = createRequire(import.meta.url);

const httpClient: HttpClient = requireFromTest("axios");
httpClient.get = async (url) => assert.fail(`unexpected network GET ${url}`);
httpClient.post = async (url) => assert.fail(`unexpected network POST ${url}`);

const { processCampaignAnalytics }: UtilsModule = requireFromTest("../utils.js");

function campaignWithInstagramPost(post: Omit<Post, "platform">): Campaign {
  return {
    brand_id: BRAND_ID,
    status: "active",
    tasks: { [TASK_ID]: { posts: { [POST_ID]: { platform: "instagram", ...post } } } },
  };
}

async function run(campaign: Campaign): Promise<string[]> {
  await processCampaignAnalytics({ campaign_id: CAMPAIGN_ID, campaign, curDate: "2026-10-16" });
  return writes.map((write) => write.path);
}

beforeEach(() => {
  reset({ [`influencer_campaigns/${CAMPAIGN_ID}/${POST_PERFORMANCE}`]: storedPerformance });
});

test("a post without creator_id writes no users/ node but keeps the shared performance copies", async () => {
  const paths = await run(campaignWithInstagramPost({}));

  assert.deepEqual(
    paths.filter((path) => path.startsWith("users/")),
    [],
  );
  assert.ok(paths.includes(`influencer_campaigns/${CAMPAIGN_ID}/${POST_PERFORMANCE}`));
  assert.ok(paths.includes(`influencer_tasks/${TASK_ID}/posts/${POST_ID}/performance`));
  assert.ok(paths.includes(`brands/${BRAND_ID}/influencer_campaigns/${CAMPAIGN_ID}/${POST_PERFORMANCE}`));
});

test("a post with creator_id still writes the creator's performance copy", async () => {
  const paths = await run(campaignWithInstagramPost({ creator_id: "creator-1" }));

  assert.ok(paths.includes(`users/creator-1/influencer_tasks/${TASK_ID}/posts/${POST_ID}/performance`));
  assert.ok(paths.includes(`influencer_campaigns/${CAMPAIGN_ID}/${POST_PERFORMANCE}`));
});
