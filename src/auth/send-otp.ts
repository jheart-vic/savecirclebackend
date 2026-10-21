import { isProduction } from "../config.js";
import { sendSms, termiiConfigured } from "../termii.js";

/** Only local development without Termii hands the code back; a real SMS never does. */
export const returnsDevCode = !termiiConfigured && !isProduction;

export async function sendOtp(phoneNumber: string, code: string): Promise<void> {
  if (termiiConfigured) {
    await sendSms(phoneNumber, `Your SaveCircle code is ${code}. It expires in 10 minutes. Do not share it.`);
  }
}
