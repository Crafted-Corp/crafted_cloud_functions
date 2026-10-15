require("dotenv").config();
const axios = require("axios");
const firebase = require(process.env.PRODEV);
const cors = require("cors")({ origin: true });
const { graphHostFor } = require("./graphHost");
const { metaMessageKey, lastErrorFor } = require("./socialErrors");

const processUserDemographics = async (userId, userData) => {
  const instagramInfo = userData?.creator_socials?.instagram;
  const accountId = instagramInfo?.api_path === "instagram"
    ? instagramInfo.instagram_user_id : instagramInfo?.instagram_business_account_id;
  if (!accountId || !instagramInfo?.access_token) return;
  const node = firebase.database().ref(`users/${userId}/creator_socials/instagram`);
  try {
    const breakdownFor = async (breakdown) => {
      const url = `${graphHostFor(instagramInfo)}/${accountId}/insights?metric=follower_demographics&period=lifetime&breakdown=${breakdown}&metric_type=total_value&access_token=${instagramInfo.access_token}`;
      const response = await axios.get(url);
      if (response.data.error) {
        const error = new Error("Instagram demographics request failed");
        error.graphError = response.data.error;
        throw error;
      }
      return response.data.data[0].total_value.breakdowns[0].results;
    };
    const genderData = await breakdownFor("gender");
    const cityData = await breakdownFor("city");
    const countryData = await breakdownFor("country");
    const ageData = await breakdownFor("age");
    const stateValues = {};
    const cityValues = {};
    const usStates = [
      "alabama",
      "alaska",
      "arizona",
      "arkansas",
      "california",
      "colorado",
      "connecticut",
      "delaware",
      "florida",
      "georgia",
      "hawaii",
      "idaho",
      "illinois",
      "indiana",
      "iowa",
      "kansas",
      "kentucky",
      "louisiana",
      "maine",
      "maryland",
      "massachusetts",
      "michigan",
      "minnesota",
      "mississippi",
      "missouri",
      "montana",
      "nebraska",
      "nevada",
      "new_hampshire",
      "new_jersey",
      "new_mexico",
      "new_york",
      "north_carolina",
      "north_dakota",
      "ohio",
      "oklahoma",
      "oregon",
      "pennsylvania",
      "rhode_island",
      "south_carolina",
      "south_dakota",
      "tennessee",
      "texas",
      "utah",
      "vermont",
      "virginia",
      "washington",
      "washington_dc",
      "west_virginia",
      "wisconsin",
      "wyoming",
    ];

    function sanitizeString(str) {
      return str.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    }

    for (const result of cityData) {
      const city = result.dimension_values[0];
      const value = result.value;
      let [cityName, state] = city.split(", ");
      cityName = sanitizeString(cityName);
      state = sanitizeString(state);

      if (usStates.includes(state)) {
        if (stateValues[state]) {
          stateValues[state].total =
            (stateValues[state].total || 0) + value;
          stateValues[state][cityName] =
            (stateValues[state][cityName] || 0) + value;
        } else {
          stateValues[state] = { total: value };
          stateValues[state][cityName] = value;
        }
      }
    }

    const countryValues = {};
    for (const result of countryData) {
      let country = result.dimension_values[0];
      const value = result.value;

      country = sanitizeString(country);

      countryValues[country] = value;
    }
    const genderValues = {};
    for (const result of genderData) {
      const gender = sanitizeString(result.dimension_values[0]);
      const value = result.value;
      genderValues[gender] = value;
    }
    const ageValues = {};
    for (const result of ageData) {
      const age = sanitizeString(result.dimension_values[0]);
      const value = result.value;
      ageValues[age] = value;
    }

    const demographics = {
      gender: genderValues,
      city: cityValues,
      states: stateValues,
      age: ageValues,
      country: countryValues,
      lastUpdated: new Date().toISOString(),
    };
    await node.update({
      ...Object.fromEntries(Object.entries(demographics).map(([key, value]) => [`demographics/${key}`, value])),
      last_error: null,
    });
  } catch (error) {
    const graphError = error.response?.data?.error ?? error.graphError;
    const messageKey = metaMessageKey(graphError);
    if (messageKey) {
      await node.update({ last_error: lastErrorFor(graphError.code, graphError.error_subcode, messageKey) });
    } else if ([4, 17, 32].includes(Number(graphError?.code))) {
      console.warn(`[WARN] rate limited for user ${userId}`);
    } else {
      console.error(`[ERROR] Failed processing Instagram demographics for user ${userId}`);
    }
  }
};

const fetchAndUpdateInstagramDemographics = async (req, res) => {
  cors(req, res, async () => {
    try {
      const usersRef = firebase.database().ref("users");
      const userId = req.query.user_id;
      if (userId) {
        const user = (await usersRef.child(userId).once("value")).val();
        if (!user) return res.status(404).json({ message: "User not found" });
        await processUserDemographics(userId, user);
      } else {
        let lastKey = null;
        for (;;) {
          let query = usersRef.orderByKey().limitToFirst(100);
          if (lastKey) query = query.startAfter(lastKey);
          const users = (await query.once("value")).val();
          const keys = users ? Object.keys(users) : [];
          if (!keys.length) break;
          for (const key of keys) {
            try {
              await processUserDemographics(key, users[key]);
            } catch {
              console.error(`[ERROR] Failed updating Instagram demographics for user ${key}`);
            }
          }
          lastKey = keys[keys.length - 1];
          if (keys.length < 100) break;
        }
      }
      return res.send("Instagram demographics data fetched and stored successfully");
    } catch {
      console.error("[ERROR] Failed reading users for Instagram demographics");
      return res.status(500).json({ message: "Failed refreshing Instagram demographics" });
    }
  });
};

module.exports = { fetchAndUpdateInstagramDemographics };
