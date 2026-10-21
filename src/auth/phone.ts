import { parsePhoneNumberFromString } from "libphonenumber-js/max";

const SEPARATORS = /[\s\-().]/g;
// +2348031234567, 2348031234567, 08031234567 or 8031234567, nothing longer.
const NIGERIAN_SHAPE = /^(?:\+?234|0)?[1-9]\d{9}$/;
const MOBILE_TYPES = new Set(["MOBILE", "FIXED_LINE_OR_MOBILE"]);

/** Returns the E.164 form of a Nigerian mobile number, or null if it is not one. */
export function normalizePhone(input: string): string | null {
  const compact = input.replace(SEPARATORS, "");
  if (!NIGERIAN_SHAPE.test(compact)) return null;

  const phone = parsePhoneNumberFromString(compact, "NG");
  if (!phone || phone.country !== "NG" || !phone.isValid()) return null;
  if (!MOBILE_TYPES.has(phone.getType() ?? "")) return null;

  return phone.number;
}
