require("dotenv").config();
const firebase = require(process.env.PRODEV);
const cors = require("cors")({ origin: true });

const insertCampaignProposalsDemographics = async (req, res) => {
  const campaignsSnapshot = await firebase
    .database()
    .ref("influencer_campaigns")
    .once("value");
  const campaigns = campaignsSnapshot.val();

  cors(req, res, async () => {
    for (const campaignId in campaigns) {
      const { tasks, brand_id: brandId, status } = campaigns[campaignId];

      if (status === "completed") {
        console.log("\n\nCampaign is completed, skipping...");
        console.log("Campaign: ", campaignId);
        console.log("Brand: ", brandId);
        console.log("Status: ", status);
        continue;
      }

      for (const taskId in tasks) {
        console.log(`\nProcessing campaign: ${campaignId}\n`);
        console.log("Task: ", taskId);
        const { proposals } = tasks[taskId];
        for (const proposalId in proposals) {
          console.log("Proposal: ", proposalId);
          const { creator_id: creatorId } = proposals[proposalId];
          const snapshot = await firebase
            .database()
            .ref("users/" + proposals[proposalId].creator_id)
            .once("value");

          if (snapshot.val()) {
            const user = snapshot.val();

            const demographics =
              user?.creator_socials?.instagram?.demographics || null;

            if (demographics) {
              await Promise.all([
                firebase
                  .database()
                  .ref(
                    `influencer_campaigns/${campaignId}/tasks/${taskId}/proposals/${proposalId}/creator_socials/instagram/demographics`,
                  )
                  .set(demographics),
                firebase
                  .database()
                  .ref(
                    `users/${creatorId}/influencer_tasks/${taskId}/proposals/${proposalId}/creator_socials/instagram/demographics`,
                  )
                  .set(demographics),
                firebase
                  .database()
                  .ref(
                    `brands/${brandId}/influencer_campaigns/${campaignId}/tasks/${taskId}/proposals/${proposalId}/creator_socials/instagram/demographics`,
                  )
                  .set(demographics),
                firebase
                  .database()
                  .ref(
                    `influencer_tasks/${taskId}/proposals/${proposalId}/creator_socials/instagram/demographics`,
                  )
                  .set(demographics),
              ]);

              console.log(`Proposal ${proposalId} updated successfully`);
            }
          }
        }
      }
    }

    res.send("All updates written into firebase.");
  });
};

module.exports = {
  insertCampaignProposalsDemographics,
};
