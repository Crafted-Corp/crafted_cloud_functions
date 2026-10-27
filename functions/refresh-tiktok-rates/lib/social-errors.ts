export interface LastError {
    code: number | string;
    subcode?: number;
    message_key: string;
    at: string;
}

const META_TOKEN_INVALID_CODE = 190;
const META_TOKEN_INVALID_SUBCODES = Object.freeze([460, 463, 467, 458, 459]);
const META_TOKEN_CODES = Object.freeze([102, 10, 200]);
const TIKTOK_INVALID_GRANT = "invalid_grant";
const TIKTOK_TOKEN_CODES = Object.freeze([2190002, 2190003, 2190008, 10010]);
const META_KEY_PREFIX = "ig_";
const TIKTOK_KEY_PREFIX = "tt_";
const META_TOKEN_INVALID_KEY = `${META_KEY_PREFIX}${META_TOKEN_INVALID_CODE}`;
const TIKTOK_INVALID_GRANT_KEY = `${TIKTOK_KEY_PREFIX}${TIKTOK_INVALID_GRANT}`;

export const metaMessageKey = (error: { code?: number; error_subcode?: number } | undefined): string | null => {
    const code = Number(error?.code);
    if (code === META_TOKEN_INVALID_CODE) {
        const subcode = Number(error?.error_subcode);
        return META_TOKEN_INVALID_SUBCODES.includes(subcode)
            ? `${META_TOKEN_INVALID_KEY}_${subcode}`
            : META_TOKEN_INVALID_KEY;
    }
    return META_TOKEN_CODES.includes(code) ? `${META_KEY_PREFIX}${code}` : null;
};

export const tiktokMessageKey = (code: number | string | undefined): string | null => {
    if (code === TIKTOK_INVALID_GRANT) return TIKTOK_INVALID_GRANT_KEY;
    return TIKTOK_TOKEN_CODES.includes(Number(code)) ? `${TIKTOK_KEY_PREFIX}${Number(code)}` : null;
};

export const lastErrorFor = (code: number | string, subcode: number | undefined, messageKey: string): LastError => ({
    code,
    ...(subcode !== undefined ? { subcode } : {}),
    message_key: messageKey,
    at: new Date().toISOString(),
});
