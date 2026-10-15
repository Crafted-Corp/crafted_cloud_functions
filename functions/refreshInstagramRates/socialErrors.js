const metaMessageKey = (error) => {
  const code = Number(error?.code);
  if (code === 190) return [460, 463, 467, 458, 459].includes(Number(error.error_subcode)) ? `ig_190_${Number(error.error_subcode)}` : "ig_190";
  return [102, 10, 200].includes(code) ? `ig_${code}` : null;
};
const tiktokMessageKey = (code) => {
  if (code === "invalid_grant") return "tt_invalid_grant";
  return [2190002, 2190003, 2190008, 10010].includes(Number(code)) ? `tt_${Number(code)}` : null;
};
const lastErrorFor = (code, subcode, message_key) => ({
  code, ...(subcode !== undefined ? { subcode } : {}), message_key, at: new Date().toISOString(),
});
module.exports = { metaMessageKey, tiktokMessageKey, lastErrorFor };
