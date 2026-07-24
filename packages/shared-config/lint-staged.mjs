export default {
    "functions/creator-outreach/**/*.{js,mjs,cjs,ts,json}": ["biome check --write --files-ignore-unknown=true"],
    "packages/**/*.{js,mjs,cjs,ts,json}": ["biome check --write --files-ignore-unknown=true"],
};
