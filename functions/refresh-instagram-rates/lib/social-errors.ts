export interface LastError {
    code: number | string;
    subcode?: number;
    message_key: string;
    at: string;
}

const META_190_SUBCODES = [460, 463, 467, 458, 459];
const META_TOKEN_CODES = [102, 10, 200];
const TIKTOK_TOKEN_CODES = [2190002, 2190003, 2190008, 10010];

export const metaMessageKey = (error: { code?: number; error_subcode?: number } | undefined): string | null => {
    const code = Number(error?.code);
    if (code === 190) {
        const subcode = Number(error?.error_subcode);
        return META_190_SUBCODES.includes(subcode) ? `ig_190_${subcode}` : "ig_190";
    }
    return META_TOKEN_CODES.includes(code) ? `ig_${code}` : null;
};

export const tiktokMessageKey = (code: number | string | undefined): string | null => {
    if (code === "invalid_grant") return "tt_invalid_grant";
    return TIKTOK_TOKEN_CODES.includes(Number(code)) ? `tt_${Number(code)}` : null;
};

export const lastErrorFor = (code: number | string, subcode: number | undefined, messageKey: string): LastError => ({
    code,
    ...(subcode !== undefined ? { subcode } : {}),
    message_key: messageKey,
    at: new Date().toISOString(),
});
