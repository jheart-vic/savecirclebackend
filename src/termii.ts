import axios from "axios";
import { config } from "./config.js";

export const termiiConfigured = Boolean(config.TERMII_API_KEY);

const termii = axios.create({ baseURL: config.TERMII_BASE_URL, timeout: 10_000 });

/** Sends one SMS through Termii; throws if Termii does not accept it. */
export async function sendSms(phoneNumber: string, text: string): Promise<void> {
  try {
    await termii.post("/api/sms/send", {
      api_key: config.TERMII_API_KEY,
      to: phoneNumber.replace("+", ""),
      from: config.TERMII_SENDER_ID,
      sms: text,
      type: "plain",
      channel: config.TERMII_CHANNEL,
    });
  } catch (error) {
    // Axios errors carry the request body (API key and the code), so never rethrow them as-is.
    if (axios.isAxiosError(error)) {
      const detail = error.response
        ? `status ${error.response.status}: ${JSON.stringify(error.response.data).slice(0, 200)}`
        : (error.code ?? "network error");
      throw new Error(`Termii SMS failed with ${detail}`);
    }
    throw error;
  }
}
