/**
 * Scanner module — batched user scan with product-specific matching.
 *
 * Studio matcher: checks creator_tasks flag + region match (state/country).
 * Amplify matcher: checks follower count range + platform + state.
 *
 * Both use the same batched pagination loop (100 users at a time) to avoid
 * reading the entire users collection into memory.
 */

const BATCH_SIZE = 100;

/**
 * Match Studio creators: users who have opted into creator_tasks and whose
 * shipping state or country matches the task's regions.
 *
 * Ported from studioOutreach/task.js:41-68.
 */
const matchBatchStudio = (users, taskRegions) => {
  const matched = [];

  Object.entries(users).forEach(([key, user]) => {
    if (!user || !user.creator_tasks) return;

    const userState =
      user.shipping_details &&
      user.shipping_details.state &&
      user.shipping_details.state.toUpperCase();
    const userCountry =
      user.shipping_details &&
      user.shipping_details.country &&
      user.shipping_details.country.toUpperCase();

    const isRegionMatch =
      (taskRegions.includes("USA") && userCountry === "USA") ||
      (taskRegions.includes("CAN") && userCountry === "CAN") ||
      (userState && taskRegions.includes(userState));

    if (isRegionMatch) {
      matched.push({
        // paypail_email is the real field name in Firebase (not a typo in code)
        email: user.email || user.paypail_email,
        id: key,
        shipping_details: user.shipping_details,
      });
    }
  });

  return matched;
};

/**
 * Parse a follower count that may be a number or a comma-separated string
 * (e.g., "12,345" -> 12345).
 *
 * Ported from server/utils/influencer.js:33-40.
 */
const parseFollowerCount = (value) => {
  if (typeof value === "string") {
    return parseInt(value.replace(/,/g, ""), 10);
  }
  return value;
};

/**
 * Match Amplify creators: users with both TikTok and Instagram follower counts,
 * combined count within range, state match, and at least one matching platform.
 *
 * Ported from server/utils/influencer.js:15-72.
 */
const matchBatchAmplify = (users, data) => {
  const matched = [];
  const [minFollowerCount, maxFollowerCount] = data.follower_count;
  const { platforms, states } = data;

  Object.entries(users).forEach(([key, user]) => {
    const instagramFollowerCount = user?.creator_socials?.instagram?.follower_count;
    const tiktokFollowerCount = user?.creator_socials?.tiktok?.performance?.followerCount;

    // Both follower counts must exist (not undefined)
    if (tiktokFollowerCount === undefined || instagramFollowerCount === undefined) {
      return;
    }

    const parsedTiktok = parseFollowerCount(tiktokFollowerCount);
    const parsedInstagram = parseFollowerCount(instagramFollowerCount);
    const followerCount = (parsedTiktok || 0) + (parsedInstagram || 0);

    if (isNaN(followerCount)) return;

    // State match: "USA" matches all users; otherwise must match exactly
    const influencerState = user?.shipping_details?.state;
    const isStateMatch =
      (states.length === 1 && states[0] === "USA") ||
      states.includes(influencerState);

    // Follower count within range
    const isFollowerMatch =
      followerCount >= minFollowerCount && followerCount <= maxFollowerCount;

    // At least one platform present in creator_socials
    const isPlatformMatch = platforms.some((p) =>
      Boolean(user?.creator_socials?.[p])
    );

    if (isStateMatch && isFollowerMatch && isPlatformMatch) {
      matched.push({
        creator_socials: user.creator_socials,
        email: user.email,
        id: key,
        shipping_details: user.shipping_details,
      });
    }
  });

  return matched;
};

/**
 * Scan all users in batches and return matching creators based on product type.
 *
 * @param {object} firebase - Firebase Admin app instance
 * @param {object} data - Validated request data (product, brand_id, etc.)
 * @returns {Promise<Array>} Array of matching creator objects
 */
const scanCreators = async (firebase, data) => {
  const usersRef = firebase.database().ref("users");
  let lastKey = null;
  let moreUsers = true;
  let matchingCreators = [];

  // For Studio, pre-extract the region values from the task
  const taskRegions = data.product === "studio"
    ? data.task.regions.map((region) => region.value)
    : null;

  while (moreUsers) {
    let query = usersRef.orderByKey().limitToFirst(BATCH_SIZE);
    if (lastKey) {
      query = query.startAfter(lastKey);
    }

    const snapshot = await query.once("value");
    const users = snapshot.val();

    if (!users) break;

    const keys = Object.keys(users);
    if (keys.length === 0) break;

    lastKey = keys[keys.length - 1];
    if (keys.length < BATCH_SIZE) moreUsers = false;

    const batch = data.product === "studio"
      ? matchBatchStudio(users, taskRegions)
      : matchBatchAmplify(users, data);

    matchingCreators = matchingCreators.concat(batch);
  }

  return matchingCreators;
};

module.exports = { scanCreators };
