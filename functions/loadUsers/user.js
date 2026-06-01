require("dotenv").config()
const cors = require('cors')({origin: true});
const firebase = require(process.env.PRODEV);
const moment = require('moment');

const loadUsersInBatches = async (req, res) => { 
  cors(req, res, async () => {
    let { query, pageSize, cursor } = req.query;
    pageSize = parseInt(pageSize, 10) || 100; // Default batch size
    console.log("query", query, "pageSize", pageSize, "cursor", cursor);

    try {
      const usersRef = firebase.database().ref('users');

      if (query && query.trim() !== "") {
        // Only filter by exact email match using orderByChild and equalTo
        let fbQuery = usersRef.orderByChild('email').equalTo(query);
        const snapshot = await fbQuery.once('value');
        const usersBatch = snapshot.val();
        if (!usersBatch) {
          return res.send({ status: 200, statuscode: "1", result: [], length: 0, next_cursor: null });
        }
        const userKeys = Object.keys(usersBatch);

        const users = userKeys.map(key => {
          const userData = usersBatch[key];
          return {
            key,
            data: {
              name: userData.name || null,
              email: userData.email,
              bio: userData.bio,
              creator_socials: userData.creator_socials,
              avatar: userData.avatar,
              shipping_details: {
                address1: userData.shipping_details && userData.shipping_details.address_1 ? userData.shipping_details.address_1 : null,
                address2: userData.shipping_details && userData.shipping_details.address_2 ? userData.shipping_details.address_2 : null,
                fullname: userData.shipping_details && userData.shipping_details.fullname ? userData.shipping_details.fullname : null,
                city: userData.shipping_details && userData.shipping_details.city ? userData.shipping_details.city : null,
                state: userData.shipping_details && userData.shipping_details.state ? userData.shipping_details.state : null,
                zipcode: userData.shipping_details && userData.shipping_details.zipcode ? userData.shipping_details.zipcode : null,
              }
            }
          };
        });

        return res.send({
          status: 200,
          statuscode: "1",
          result: users,
          length: users.length,
          next_cursor: null
        });
      }

      // Batched fetch if no query
      let fbQuery = usersRef.orderByKey().limitToFirst(pageSize + 1);
      if (cursor) {
        fbQuery = fbQuery.startAt(cursor);
      }
      const snapshot = await fbQuery.once('value');
      const batchUsers = snapshot.val();
      if (!batchUsers) {
        return res.send({ status: 200, statuscode: "1", result: [], length: 0, nextCursor: null });
      }
      const userKeys = Object.keys(batchUsers);

      let nextCursor = null;
      let keysToReturn = userKeys;
      if (userKeys.length > pageSize) {
        // More users exist, set nextCursor and trim the last user
        nextCursor = userKeys[pageSize];
        keysToReturn = userKeys.slice(0, pageSize);
      }

      let users = [];
      keysToReturn.forEach((key) => {
        const userData = batchUsers[key];
        const userObject = {
          key: key,
          data: {
            name: userData.name || null,
            email: userData.email,
            bio: userData.bio,
            creator_socials: userData.creator_socials,
            avatar: userData.avatar,
            shipping_details: {
              address1: userData.shipping_details && userData.shipping_details.address_1 ? userData.shipping_details.address_1 : null,
              address2: userData.shipping_details && userData.shipping_details.address_2 ? userData.shipping_details.address_2 : null,
              fullname: userData.shipping_details && userData.shipping_details.fullname ? userData.shipping_details.fullname : null,
              city: userData.shipping_details && userData.shipping_details.city ? userData.shipping_details.city : null,
              state: userData.shipping_details && userData.shipping_details.state ? userData.shipping_details.state : null,
              zipcode: userData.shipping_details && userData.shipping_details.zipcode ? userData.shipping_details.zipcode : null,
            }
          }
        };
        users.push(userObject);
      });

      res.send({ 
        status: 200, 
        statuscode: "1", 
        result: users, 
        length: users.length, 
        next_cursor: nextCursor 
      });
    } catch (error) {
      console.error('Error loading users:', error);
      res.status(500).send({ message: 'Internal server error' });
    }
  });
}

module.exports = { 
  loadUsersInBatches,
}