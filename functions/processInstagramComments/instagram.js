require('dotenv').config();
const axios = require('axios');
const firebase = require(process.env.PRODEV);
const cors = require('cors')({origin: true});

const BATCH_SIZE = 10;

async function processCampaignComments(campaignId, campaign) {
  const taskIds = Object.keys(campaign.tasks || {});
  console.log(`[processInstagramComments] Campaign ${campaignId}: ${taskIds.length} tasks`);

  let postsProcessed = 0;
  let commentsCollected = 0;
  let skipped = 0;

  for (const taskId of taskIds) {
    const task = campaign.tasks[taskId];

    if (!task.posts) {
      console.log(`[processInstagramComments]   Task ${taskId}: no posts — skipping`);
      continue;
    }

    const postIds = Object.keys(task.posts);
    console.log(`[processInstagramComments]   Task ${taskId}: ${postIds.length} posts`);

    for (const postId of postIds) {
      const post = task.posts[postId];

      if (!post.media_id) {
        console.log(`[processInstagramComments]     Post ${postId}: no media_id — skipping`);
        skipped++;
        continue;
      }

      const creatorId = post.creator_id;
      console.log(`[processInstagramComments]     Post ${postId}: media_id=${post.media_id}, creator=${creatorId} — fetching creator socials`);
      const creatorRef = firebase.database().ref(`users/${creatorId}/creator_socials/instagram`);
      const creatorSnapshot = await creatorRef.once('value');
      const creatorData = creatorSnapshot.val();

      if (!creatorData || !creatorData.instagram_business_account_id || !creatorData.access_token) {
        console.log(`[processInstagramComments]     Post ${postId}: creator ${creatorId} missing IG credentials — skipping (has_data=${!!creatorData}, has_ig_id=${!!(creatorData && creatorData.instagram_business_account_id)}, has_token=${!!(creatorData && creatorData.access_token)})`);
        skipped++;
        continue;
      }

      try {
        const url = `https://graph.facebook.com/v24.0/${post.media_id}/comments?access_token=${creatorData.access_token}`;
        console.log(`[processInstagramComments]     Post ${postId}: calling Graph API for comments`);

        const response = await axios.get(url);
        if (response.status === 400) {
          console.log(`[processInstagramComments]     Post ${postId}: Graph API returned 400 — skipping`);
          skipped++;
          continue;
        }
        if (response.data.error) {
          console.log(`[processInstagramComments]     Post ${postId}: Graph API returned error — ${JSON.stringify(response.data.error)} — skipping`);
          skipped++;
          continue;
        }

        const comments = response.data.data;
        const commentCount = (comments || []).length;
        console.log(`[processInstagramComments]     Post ${postId}: received ${commentCount} comments`);
        postsProcessed++;
        commentsCollected += commentCount;

        const commentsRef = firebase.database().ref('influencer_campaigns').child(campaignId).child('instagram_comments').child(postId);
        await commentsRef.set(comments);
        console.log(`[processInstagramComments]     Post ${postId}: saved ${commentCount} comments to Firebase`);
      } catch (error) {
        console.error(`[processInstagramComments]     Post ${postId}: EXCEPTION — ${error.message}`, error.response?.status, error.response?.data);
        skipped++;
        continue;
      }
    }
  }

  return { postsProcessed, commentsCollected, skipped };
}

const processInstagramComments = async (req, res) => {
  cors(req, res, async () => {
    try {
      const campaignsRef = firebase.database().ref('influencer_campaigns');
      const campaignId = req.query.campaign_id;

      if (campaignId) {
        console.log(`[processInstagramComments] Single-campaign mode — campaign_id=${campaignId}`);
        const snapshot = await campaignsRef.child(campaignId).once('value');
        const campaign = snapshot.val();

        if (!campaign || Object.keys(campaign).length === 0) {
          console.warn(`[processInstagramComments] Campaign ${campaignId} not found or is empty`);
          return res.status(404).json({ error: `Campaign ${campaignId} not found` });
        }

        const stats = await processCampaignComments(campaignId, campaign);
        console.log(`[processInstagramComments] Done (single) — postsProcessed=${stats.postsProcessed}, commentsCollected=${stats.commentsCollected}, skipped=${stats.skipped}`);
        return res.status(200).json({ message: `Campaign ${campaignId} processed successfully`, ...stats });
      }

      console.log(`[processInstagramComments] Full-run mode — processing all campaigns in batches of ${BATCH_SIZE}`);
      let lastKey = null;
      let moreCampaigns = true;
      let batchCount = 0;
      let totalPostsProcessed = 0;
      let totalCommentsCollected = 0;
      let totalSkipped = 0;
      let totalCampaigns = 0;

      while (moreCampaigns) {
        let query = campaignsRef.orderByKey().limitToFirst(BATCH_SIZE);
        if (lastKey) {
          query = query.startAfter(lastKey);
        }

        const snapshot = await query.once('value');
        const campaigns = snapshot.val() || {};
        const campaignKeys = Object.keys(campaigns);

        if (campaignKeys.length === 0) {
          break;
        }

        lastKey = campaignKeys[campaignKeys.length - 1];
        if (campaignKeys.length < BATCH_SIZE) {
          moreCampaigns = false;
        }

        batchCount++;
        console.log(`[processInstagramComments] Batch ${batchCount}: ${campaignKeys.length} campaigns (${campaignKeys.join(', ')})`);

        for (const [id, campaign] of Object.entries(campaigns)) {
          if (!campaign || Object.keys(campaign).length === 0) {
            console.warn(`[processInstagramComments] Campaign ${id} is null/empty — skipping`);
            continue;
          }

          try {
            const stats = await processCampaignComments(id, campaign);
            totalPostsProcessed += stats.postsProcessed;
            totalCommentsCollected += stats.commentsCollected;
            totalSkipped += stats.skipped;
            totalCampaigns++;
            console.log(`[processInstagramComments] Campaign ${id} done — postsProcessed=${stats.postsProcessed}, commentsCollected=${stats.commentsCollected}, skipped=${stats.skipped}`);
          } catch (err) {
            console.error(`[processInstagramComments] Campaign ${id}: EXCEPTION — ${err.message}`, err.stack);
          }
        }
      }

      console.log(`[processInstagramComments] Full run complete — batches=${batchCount}, campaigns=${totalCampaigns}, postsProcessed=${totalPostsProcessed}, commentsCollected=${totalCommentsCollected}, skipped=${totalSkipped}`);
      res.status(200).json({ message: 'Influencer campaigns processed successfully', campaigns: totalCampaigns, postsProcessed: totalPostsProcessed, commentsCollected: totalCommentsCollected, skipped: totalSkipped });
    } catch (error) {
      console.error('[processInstagramComments] FATAL error:', error.message, error.stack);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
};

module.exports = {
  processInstagramComments,
}
