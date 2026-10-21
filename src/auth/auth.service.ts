import { config } from "../config.js";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";
import * as authModel from "./auth.model.js";
import { generateOtp, generateSessionToken, hashSecret, secretsMatch } from "./crypto.js";
import { returnsDevCode, sendOtp } from "./send-otp.js";

const OTP_TTL_MS = 10 * 60 * 1000;
const REQUEST_WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 3;
const MAX_ATTEMPTS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const invalidCode = () => new AppError(401, "invalid_code", "The code is wrong or has expired");

function hashOtp(phoneNumber: string, code: string): string {
  return hashSecret(`${phoneNumber}:${code}`);
}

async function deliverCode(challengeId: string, phoneNumber: string, code: string): Promise<void> {
  try {
    await sendOtp(phoneNumber, code);
  } catch (error) {
    console.error(error);
    // An undelivered code must not count toward the phone's hourly limit.
    await authModel.deleteChallenge(challengeId).catch((deleteError: unknown) => console.error(deleteError));
    throw new AppError(503, "otp_delivery_failed", "We could not send the code. Try again.");
  }
}

type RequestCodeInput =
  | { purpose: "sign_up"; name: string; phoneNumber: string; ip: string }
  | { purpose: "sign_in"; phoneNumber: string; ip: string };

export async function requestCode(input: RequestCodeInput): Promise<{ devCode?: string }> {
  const { purpose, phoneNumber, ip } = input;
  const user = await authModel.findUserByPhone(phoneNumber);
  await authModel.recordAuthEvent({ userId: user?.id, phoneNumber, event: "otp_requested", ip });

  const code = generateOtp();
  // A sign-in for a number with no account gets no SMS.
  const wantsSms = purpose === "sign_up" || user !== null;

  const challenge = await prisma.$transaction(async (tx) => {
    // Serialises requests for one phone so parallel calls cannot slip past the limit.
    await authModel.lockPhone(phoneNumber, tx);

    const since = new Date(Date.now() - REQUEST_WINDOW_MS);
    if ((await authModel.countChallengesSince(phoneNumber, since, tx)) >= MAX_REQUESTS_PER_WINDOW) {
      throw new AppError(429, "otp_rate_limited", "Too many codes requested. Try again in an hour.");
    }

    // Caps SMS spend if an attacker rotates phone numbers and IPs. Only texted codes count,
    // so sign-ins for unknown numbers (which cost nothing) cannot use the cap up.
    const dayAgo = new Date(Date.now() - DAY_MS);
    const capReached = (await authModel.countTextedChallengesSince(dayAgo, tx)) >= config.OTP_DAILY_LIMIT;
    if (capReached) {
      console.error(`OTP daily limit of ${config.OTP_DAILY_LIMIT} reached; refusing new codes`);
      // Sign-in still replies 202 with nothing sent, so the cap cannot reveal who has an account.
      if (purpose === "sign_up") {
        throw new AppError(503, "otp_unavailable", "Sign-in codes are paused for now. Try again later.");
      }
    }

    return authModel.createChallenge(
      {
        phoneNumber,
        purpose,
        signupName: input.purpose === "sign_up" ? input.name : null,
        sendsSms: wantsSms && !capReached,
        codeHash: hashOtp(phoneNumber, code),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
      tx,
    );
  });

  const devCode = returnsDevCode ? code : undefined;

  if (purpose === "sign_in") {
    // Reply without waiting for the SMS, so a real account and an unknown number take the
    // same time and neither can see a delivery error. Unknown numbers (and every sign-in
    // once the daily cap is reached) get no SMS; the challenge still counts per phone.
    if (!challenge.sendsSms) return {};
    void deliverCode(challenge.id, phoneNumber, code).catch(() => {});
    return { devCode };
  }

  await deliverCode(challenge.id, phoneNumber, code);
  return { devCode };
}

type VerifyCodeInput = { phoneNumber: string; code: string; ip: string };

export async function verifyCode({ phoneNumber, code, ip }: VerifyCodeInput) {
  // Only the newest code for a phone can ever work; requesting a new one retires the old.
  const challenge = await authModel.findLatestChallenge(phoneNumber);
  const existingUser = await authModel.findUserByPhone(phoneNumber);

  const fail = async () => {
    await authModel.recordAuthEvent({ userId: existingUser?.id, phoneNumber, event: "otp_failed", ip });
    return invalidCode();
  };

  if (!challenge) throw await fail();

  // Spend the attempt before comparing, so parallel guesses can never exceed MAX_ATTEMPTS.
  const { count: reserved } = await authModel.reserveAttempt(challenge.id, MAX_ATTEMPTS);
  if (reserved === 0 || !secretsMatch(challenge.codeHash, hashOtp(phoneNumber, code))) {
    throw await fail();
  }

  const { signupName } = challenge;

  // Returns null when the code cannot sign anyone in.
  const signedIn = await prisma.$transaction(async (tx) => {
    const consumed = await authModel.consumeChallenge(challenge.id, tx);
    // Another request used this code a moment earlier.
    if (consumed.count === 0) return null;

    let user = existingUser;
    if (!user) {
      // Only a sign-up code creates an account; a sign-up for an existing phone just signs in.
      if (!signupName) return null;
      user = await authModel.createUser({ name: signupName, phoneNumber }, tx);
    }

    const token = generateSessionToken();
    const session = await authModel.createSession(
      {
        userId: user.id,
        tokenHash: hashSecret(token),
        expiresAt: new Date(Date.now() + config.SESSION_TTL_DAYS * DAY_MS),
      },
      tx,
    );
    await authModel.recordAuthEvent({ userId: user.id, phoneNumber, event: "signed_in", ip }, tx);

    return { user, token, expiresAt: session.expiresAt };
  });

  if (!signedIn) throw await fail();
  return signedIn;
}

export type AuthContext = {
  sessionId: string;
  expiresAt: Date;
  user: { id: string; name: string; phoneNumber: string };
};

const unauthenticated = () => new AppError(401, "unauthenticated", "Sign in to continue");

export async function authenticate(token: string | undefined): Promise<AuthContext> {
  if (!token) throw unauthenticated();

  const session = await authModel.findActiveSession(hashSecret(token));
  if (!session) throw unauthenticated();

  const { id, name, phoneNumber } = session.user;
  return { sessionId: session.id, expiresAt: session.expiresAt, user: { id, name, phoneNumber } };
}

export async function signOut(auth: AuthContext, ip: string): Promise<void> {
  const { id: userId, phoneNumber } = auth.user;
  await prisma.$transaction(async (tx) => {
    await authModel.revokeSession(auth.sessionId, userId, tx);
    await authModel.recordAuthEvent({ userId, phoneNumber, event: "signed_out", ip }, tx);
  });
}

export async function listSessions(auth: AuthContext) {
  const sessions = await authModel.listActiveSessions(auth.user.id);
  return sessions.map((session) => ({ ...session, current: session.id === auth.sessionId }));
}

export async function revokeSession(auth: AuthContext, sessionId: string, ip: string): Promise<void> {
  const { id: userId, phoneNumber } = auth.user;
  await prisma.$transaction(async (tx) => {
    const { count } = await authModel.revokeSession(sessionId, userId, tx);
    // Someone else's session looks the same as a missing one.
    if (count === 0) throw new AppError(404, "session_not_found", "Session not found");
    await authModel.recordAuthEvent({ userId, phoneNumber, event: "session_revoked", ip }, tx);
  });
}
