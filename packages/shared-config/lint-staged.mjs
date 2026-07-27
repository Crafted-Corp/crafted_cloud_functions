export default {
    "*.{js,ts,cjs,mjs,d.cts,d.mts,jsx,tsx,json,jsonc}": [
        "biome check --write --files-ignore-unknown=true", // Check formatting and lint
    ],
};
