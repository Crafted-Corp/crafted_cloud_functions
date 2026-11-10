/**
 * Deployment environment resolution, shared by every module that varies by NODE_ENV.
 */

export const ENVIRONMENTS = ["dev", "staging", "prod"] as const;

export type Environment = (typeof ENVIRONMENTS)[number];

// An unknown NODE_ENV must fail loudly: callers pick data projects and links from it, and a
// silent fallback to prod would point non-prod traffic at production.
export const resolveEnvironment = (raw: string | undefined = process.env.NODE_ENV): Environment => {
    const value = raw || "dev";
    const environment = ENVIRONMENTS.find((candidate) => candidate === value);
    if (!environment) {
        throw new Error(`Unknown NODE_ENV "${value}". Expected one of: ${ENVIRONMENTS.join(", ")}`);
    }
    return environment;
};

// Where creators land from outreach emails; each environment must link to its own client.
const FRONTEND_ORIGINS: Record<Environment, string> = {
    dev: "https://crafted-web-dev-client.herokuapp.com",
    staging: "https://crafted-web-staging-client-4fdf273c9eea.herokuapp.com",
    prod: "https://www.app.cookwithcrafted.com",
};

const CREATOR_TASKS_PATH = "/creator/dashboard/tasks";

export const getCreatorTasksUrl = (environment: Environment): string =>
    `${FRONTEND_ORIGINS[environment]}${CREATOR_TASKS_PATH}`;
