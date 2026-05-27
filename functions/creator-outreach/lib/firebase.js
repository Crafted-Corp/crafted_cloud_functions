const admin = require("firebase-admin");
const path = require("path");

const envConfigs = {
  development: {
    databaseURL: "https://crafted-dev-v1-default-rtdb.firebaseio.com",
    keyFile: "config/devServiceAccountKey.json",
  },
  staging: {
    databaseURL: "https://crafted-staging-v1-default-rtdb.firebaseio.com",
    keyFile: "config/stagingServiceAccountKey.json",
  },
  production: {
    databaseURL: "https://crafted-v1.firebaseio.com",
    keyFile: "config/serviceAccountKey.json",
  },
};

const env = process.env.NODE_ENV || "development";
const config = envConfigs[env];

if (!config) {
  throw new Error(
    `Unknown NODE_ENV "${env}". Expected one of: ${Object.keys(envConfigs).join(", ")}`
  );
}

const keyPath = path.resolve(__dirname, "..", config.keyFile);

let serviceAccount;
try {
  serviceAccount = require(keyPath);
} catch (err) {
  throw new Error(
    `Firebase service account key not found at "${keyPath}" (NODE_ENV=${env}). ` +
    `Place the correct key file at "${config.keyFile}" relative to the function root.`
  );
}

const app = admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: config.databaseURL,
});

module.exports = app;
