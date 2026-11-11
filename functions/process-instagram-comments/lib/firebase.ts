import path from "node:path";
import * as admin from "firebase-admin";
import { resolveEnvironment, verifyCredentialProject } from "./environment";

const config = resolveEnvironment(process.env.NODE_ENV);
const serviceAccount: Parameters<typeof admin.credential.cert>[0] = require(
    path.resolve(__dirname, "..", "config", config.keyFile),
);
verifyCredentialProject(config, serviceAccount);
export default admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: config.databaseURL,
});
