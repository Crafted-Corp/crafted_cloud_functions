require("dotenv").config();
const axios = require("axios");
const firebase = require(process.env.PRODEV);
const cors = require("cors")({ origin: true });

const fetchAndUpdateInstagramDemographics = async (req, res) => {
  cors(req, res, async () => {
    const usersRef = firebase.database().ref("users");
    let lastKey = null;
    const batchSize = 100; // Adjust the batch size as needed

    do {
      let query = usersRef.orderByKey().limitToFirst(batchSize);
      if (lastKey) {
        query = query.startAfter(lastKey);
      }

      const usersSnapshot = await query.once("value");
      const usersData = usersSnapshot.val();

      if (!usersData) break;

      lastKey = Object.keys(usersData).pop(); // Get the last key in the current batch

      for (const userId in usersData) {
        if (usersData.hasOwnProperty(userId)) {
          const userData = usersData[userId];
          const instagramInfo =
            userData.creator_socials && userData.creator_socials.instagram;

          if (
            instagramInfo &&
            instagramInfo.instagram_business_account_id &&
            instagramInfo.access_token
          ) {
            const business_account_id =
              instagramInfo.instagram_business_account_id;
            const access_token = instagramInfo.access_token;

            const cityApi = `https://graph.facebook.com/v24.0/${business_account_id}/insights?metric=follower_demographics&period=lifetime&breakdown=city&metric_type=total_value&access_token=${access_token}`;
            const countryApi = `https://graph.facebook.com/v24.0/${business_account_id}/insights?metric=follower_demographics&period=lifetime&breakdown=country&metric_type=total_value&access_token=${access_token}`;
            const genderApi = `https://graph.facebook.com/v24.0/${business_account_id}/insights?metric=follower_demographics&period=lifetime&breakdown=gender&metric_type=total_value&access_token=${access_token}`;
            const ageApi = `https://graph.facebook.com/v24.0/${business_account_id}/insights?metric=follower_demographics&period=lifetime&breakdown=age&metric_type=total_value&access_token=${access_token}`;

            try {
              const genderApiResponse = await axios.get(genderApi);
              const genderData =
                genderApiResponse.data.data[0].total_value.breakdowns[0]
                  .results;
              const cityApiResponse = await axios.get(cityApi);
              const cityData =
                cityApiResponse.data.data[0].total_value.breakdowns[0].results;
              const countryApiResponse = await axios.get(countryApi);
              const countryData =
                countryApiResponse.data.data[0].total_value.breakdowns[0]
                  .results;
              const ageApiResponse = await axios.get(ageApi);
              const ageData =
                ageApiResponse.data.data[0].total_value.breakdowns[0].results;

              const stateValues = {};
              const cityValues = {};
              // const usStates = ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "Washington DC", "West Virginia", "Wisconsin", "Wyoming"];
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

              // Function to sanitize strings
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
              }

              // Store the extracted and sanitized values in Firebase
              await firebase
                .database()
                .ref(`users/${userId}/creator_socials/instagram/demographics`)
                .update(demographics);
            } catch (error) {
              console.error(
                "Failed to fetch and store Instagram demographics data:",
                error,
              );
              continue; // Continue to the next user
            }
          }
        }
      }
    } while (lastKey);

    res.send("Instagram demographics data fetched and stored successfully");
  });
};

module.exports = {
  fetchAndUpdateInstagramDemographics,
};
