import { isProduction } from "../config.js";
import { sendSms, termiiConfigured } from "../termii.js";

/** Texts the code when Termii is configured; outside production also hands it back for testing. */
export async function sendOtp(phoneNumber: string, code: string): Promise<{ devCode?: string }> {
  if (termiiConfigured) {
    await sendSms(phoneNumber, `Your SaveCircle code is ${code}. It expires in 10 minutes. Do not share it.`);
  }
  return isProduction ? {} : { devCode: code };
}
