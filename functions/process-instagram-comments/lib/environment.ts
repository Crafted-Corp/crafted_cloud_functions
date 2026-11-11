export interface EnvironmentConfig {
    databaseURL: string;
    keyFile: string;
    projectId: string;
}
export const resolveEnvironment = (env: string | undefined): EnvironmentConfig => {
    switch (env) {
        case "dev":
            return {
                databaseURL: "https://crafted-dev-v1-default-rtdb.firebaseio.com",
                keyFile: "devServiceAccountKey.json",
                projectId: "crafted-dev-v1",
            };
        case "staging":
            return {
                databaseURL: "https://crafted-staging-v1-default-rtdb.firebaseio.com",
                keyFile: "stagingServiceAccountKey.json",
                projectId: "crafted-staging-v1",
            };
        case "prod":
            return {
                databaseURL: "https://crafted-v1.firebaseio.com",
                keyFile: "serviceAccountKey.json",
                projectId: "crafted-v1",
            };
        default:
            throw new Error("NODE_ENV must be dev, staging or prod");
    }
};
export const verifyCredentialProject = (config: EnvironmentConfig, key: unknown): void => {
    if (!key || typeof key !== "object" || !("project_id" in key) || key.project_id !== config.projectId)
        throw new Error("Firebase credential project does not match NODE_ENV");
};
