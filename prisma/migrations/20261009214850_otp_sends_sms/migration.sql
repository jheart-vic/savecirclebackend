-- AlterTable: existing challenges are counted as texted (the conservative choice for the
-- daily cap); the temporary default fills them, then is dropped so new rows must say.
ALTER TABLE "otp_challenges" ADD COLUMN "sends_sms" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "otp_challenges" ALTER COLUMN "sends_sms" DROP DEFAULT;
