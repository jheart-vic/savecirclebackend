import axios from "axios";
import { config, isTurnstileTestSecret } from "./config.js";

// Cloudflare's published test secret that accepts any token. Config refuses a missing or
// test secret in production, so this fallback only ever runs in development or test.
const TEST_SECRET = "1x0000000000000000000000000000000AA";
const secret = config.TURNSTILE_SECRET_KEY ?? TEST_SECRET;
const usingTestSecret = isTurnstileTestSecret(secret);
const expectedHostname = new URL(config.FRONTEND_ORIGIN).hostname;

// These mean our setup is wrong, not that the visitor failed, so they must be noticed.
const SETUP_ERRORS = new Set(["missing-input-secret", "invalid-input-secret", "bad-request", "internal-error"]);

const cloudflare = axios.create({ baseURL: "https://challenges.cloudflare.com", timeout: 10_000 });

type SiteverifyResponse = { success: boolean; hostname?: string; "error-codes"?: string[] };

/** Asks Cloudflare whether a Turnstile token is genuine; throws if the check itself cannot run. */
export async function verifyHuman(token: string, ip: string): Promise<boolean> {
  let data: SiteverifyResponse;
  try {
    ({ data } = await cloudflare.post<SiteverifyResponse>("/turnstile/v0/siteverify", {
      secret,
      response: token,
      remoteip: ip,
    }));
  } catch (error) {
    // Axios errors carry the request body (our secret), so never rethrow them as-is.
    if (axios.isAxiosError(error)) {
      const detail = error.response ? `status ${error.response.status}` : (error.code ?? "network error");
      throw new Error(`Turnstile siteverify failed with ${detail}`);
    }
    throw error;
  }

  const codes = data["error-codes"] ?? [];
  if (codes.some((code) => SETUP_ERRORS.has(code))) {
    throw new Error(`Turnstile siteverify rejected the request: ${codes.join(", ")}`);
  }

  // Test secrets report a placeholder hostname, so only real keys are checked against ours.
  return data.success && (usingTestSecret || data.hostname === expectedHostname);
}
