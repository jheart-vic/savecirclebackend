-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('sign_up', 'sign_in');

-- AlterTable: existing challenges predate sign-up/sign-in and are treated as sign-in;
-- the temporary default fills them, then is dropped so new rows must state a purpose.
ALTER TABLE "otp_challenges" ADD COLUMN "purpose" "OtpPurpose" NOT NULL DEFAULT 'sign_in',
ADD COLUMN "signup_name" TEXT;
ALTER TABLE "otp_challenges" ALTER COLUMN "purpose" DROP DEFAULT;
