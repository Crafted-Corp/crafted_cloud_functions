require("dotenv").config();
const firebase = require(process.env.PRODEV);
const cors = require("cors")({ origin: true });
const xlsx = require("xlsx");

const insertCampaignDrafts = async (req, res) => {
  const workbook = xlsx.readFile("proposal_submission.csv");

  cors(req, res, async () => {
    workbook.SheetNames.forEach(async (sheetName) => {
      const worksheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(worksheet);

      for (const row of data) {
        const campaignId = row["Campaign UID"];
        const taskId = row["Task UID"];
        const creatorId = row["Creator UID"];
        const brandId = row["Brand UID"];
        const proposalDescription = row["Proposal Description"];
        const status = row["Proposal"];

        const logObject = {
          campaignId,
          taskId,
          creatorId,
          brandId,
          proposalDescription,
          status,
        };

        if (
          !campaignId ||
          !taskId ||
          !creatorId ||
          !brandId ||
          !proposalDescription ||
          status !== "Missing"
        ) {
          console.error("Missing data in row:", logObject);
          continue;
        }

        try {
          const newProposalKey = firebase
            .database()
            .ref()
            .child(`influencer_campaigns/${campaignId}/tasks/${taskId}/proposals`)
            .push().key;

          const creatorSnapshot = await firebase
            .database()
            .ref(`users/${creatorId}`)
            .once("value");
          const creator = creatorSnapshot.val();

          if (!creator) {
            console.error("Creator not found: ", creatorId);
            continue;
          }

          const proposal = {
            campaign_id: campaignId,
            creator_address: creator.shipping_details,
            creator_id: creatorId,
            creator_name: creator.username,
            creator_photo: creator.avatar || "",
            creator_socials: creator.creator_socials,
            proposal: proposalDescription,
            task_id: taskId,
            average_rating: creator.average_rating || "Not rated",
          };

          await Promise.all([
            firebase
              .database()
              .ref(
                `influencer_campaigns/${campaignId}/tasks/${taskId}/proposals/${newProposalKey}`,
              )
              .set(proposal),
            firebase
              .database()
              .ref(
                `users/${creatorId}/influencer_tasks/${taskId}/proposals/${newProposalKey}`,
              )
              .set(proposal),
            firebase
              .database()
              .ref(
                `brands/${brandId}/influencer_campaigns/${campaignId}/tasks/${taskId}/proposals/${newProposalKey}`,
              )
              .set(proposal),
            firebase
              .database()
              .ref(`influencer_tasks/${taskId}/proposals/${newProposalKey}`)
              .set(proposal),
          ]);

          console.log("Proposal added successfully:", logObject);
        } catch (error) {
          console.error("Error writing data to Firebase:", logObject, error);
        }
      }
    });

    res.send("All updates written into firebase.");
  });
};

module.exports = {
  insertCampaignDrafts,
};
