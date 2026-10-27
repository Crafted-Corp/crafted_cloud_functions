import path from "node:path";
import * as admin from "firebase-admin";

interface EnvConfig {
    databaseURL: string;
    keyFile: string;
}

const envConfigs: Record<string, EnvConfig> = {
    dev: {
        databaseURL: "https://crafted-dev-v1-default-rtdb.firebaseio.com",
        keyFile: "config/devServiceAccountKey.json",
    },
    staging: {
        databaseURL: "https://crafted-staging-v1-default-rtdb.firebaseio.com",
        keyFile: "config/stagingServiceAccountKey.json",
    },
    prod: {
        databaseURL: "https://crafted-v1.firebaseio.com",
        keyFile: "config/serviceAccountKey.json",
    },
};

const env = process.env.NODE_ENV || "dev";
const config = envConfigs[env];

if (!config) {
    throw new Error(`Unknown NODE_ENV "${env}". Expected one of: ${Object.keys(envConfigs).join(", ")}`);
}

const keyPath = path.resolve(__dirname, "..", config.keyFile);

// The key path is computed from NODE_ENV at runtime, so the service account must
// be loaded with a dynamic require — a static import cannot resolve a runtime path.
let serviceAccount: Parameters<typeof admin.credential.cert>[0];
try {
    serviceAccount = require(keyPath);
} catch {
    throw new Error(
        `Firebase service account key not found at "${keyPath}" (NODE_ENV=${env}). ` +
            `Place the correct key file at "${config.keyFile}" relative to the function root.`,
    );
}

const app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: config.databaseURL,
});

export default app;
