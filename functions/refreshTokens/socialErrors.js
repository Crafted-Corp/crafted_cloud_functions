const META_TOKEN_INVALID_CODE = 190;
const META_TOKEN_INVALID_SUBCODES = Object.freeze([460, 463, 467, 458, 459]);
const META_TOKEN_CODES = Object.freeze([102, 10, 200]);
const TIKTOK_INVALID_GRANT = "invalid_grant";
const TIKTOK_TOKEN_CODES = Object.freeze([2190002, 2190003, 2190008, 10010]);
const META_KEY_PREFIX = "ig_";
const TIKTOK_KEY_PREFIX = "tt_";
const META_TOKEN_INVALID_KEY = `${META_KEY_PREFIX}${META_TOKEN_INVALID_CODE}`;
const TIKTOK_INVALID_GRANT_KEY = `${TIKTOK_KEY_PREFIX}${TIKTOK_INVALID_GRANT}`;

const metaMessageKey = (error) => {
  const code = Number(error?.code);
  if (code === META_TOKEN_INVALID_CODE) {
    return META_TOKEN_INVALID_SUBCODES.includes(Number(error.error_subcode))
      ? `${META_TOKEN_INVALID_KEY}_${Number(error.error_subcode)}`
      : META_TOKEN_INVALID_KEY;
  }
  return META_TOKEN_CODES.includes(code) ? `${META_KEY_PREFIX}${code}` : null;
};
const tiktokMessageKey = (code) => {
  if (code === TIKTOK_INVALID_GRANT) return TIKTOK_INVALID_GRANT_KEY;
  return TIKTOK_TOKEN_CODES.includes(Number(code))
    ? `${TIKTOK_KEY_PREFIX}${Number(code)}`
    : null;
};
const lastErrorFor = (code, subcode, message_key) => ({
  code, ...(subcode !== undefined ? { subcode } : {}), message_key, at: new Date().toISOString(),
});
module.exports = { metaMessageKey, tiktokMessageKey, lastErrorFor };
