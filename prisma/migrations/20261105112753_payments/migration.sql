-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('transfer', 'cash');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('matched', 'unmatched');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "virtual_account_id" UUID,
    "member_id" UUID,
    "channel" "PaymentChannel" NOT NULL,
    "amount" INTEGER NOT NULL,
    "provider_ref" TEXT,
    "sender_name" TEXT,
    "narration" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "logged_by" UUID,
    "match_status" "MatchStatus" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contributions" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "paid_at" TIMESTAMPTZ(3) NOT NULL,
    "logged_by" UUID,
    "payment_id" UUID NOT NULL,
    "reverses_id" UUID,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_credits" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "source_payment_id" UUID,
    "applied_to_cycle_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_credits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_ref_key" ON "payments"("provider_ref");

-- CreateIndex
CREATE INDEX "payments_organisation_id_received_at_idx" ON "payments"("organisation_id", "received_at");

-- CreateIndex
CREATE INDEX "contributions_cycle_id_member_id_idx" ON "contributions"("cycle_id", "member_id");

-- CreateIndex
CREATE INDEX "contributions_payment_id_idx" ON "contributions"("payment_id");

-- CreateIndex
CREATE INDEX "member_credits_member_id_idx" ON "member_credits"("member_id");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_logged_by_fkey" FOREIGN KEY ("logged_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_logged_by_fkey" FOREIGN KEY ("logged_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "contributions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_credits" ADD CONSTRAINT "member_credits_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_credits" ADD CONSTRAINT "member_credits_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_credits" ADD CONSTRAINT "member_credits_source_payment_id_fkey" FOREIGN KEY ("source_payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_credits" ADD CONSTRAINT "member_credits_applied_to_cycle_id_fkey" FOREIGN KEY ("applied_to_cycle_id") REFERENCES "cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Row-level security (hand-written). Money tables are append-only: only SELECT and INSERT
-- policies exist, so the app role can never update or delete a payment, contribution, or credit.
-- Corrections are new rows (reversals, feature 6).
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contributions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "member_credits" ENABLE ROW LEVEL SECURITY;

CREATE POLICY payments_select ON "payments" FOR SELECT USING (organisation_id = app_current_org());
CREATE POLICY payments_insert ON "payments" FOR INSERT WITH CHECK (organisation_id = app_current_org());

CREATE POLICY contributions_select ON "contributions" FOR SELECT USING (organisation_id = app_current_org());
CREATE POLICY contributions_insert ON "contributions" FOR INSERT WITH CHECK (organisation_id = app_current_org());

CREATE POLICY member_credits_select ON "member_credits" FOR SELECT USING (organisation_id = app_current_org());
CREATE POLICY member_credits_insert ON "member_credits" FOR INSERT WITH CHECK (organisation_id = app_current_org());
