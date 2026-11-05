-- CreateEnum
CREATE TYPE "RotationStatus" AS ENUM ('draft', 'active', 'paused', 'completed', 'dissolved');

-- CreateEnum
CREATE TYPE "SlotStatus" AS ENUM ('scheduled', 'paid_out', 'gap', 'held', 'skipped');

-- CreateTable
CREATE TABLE "rotations" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "rotation_number" INTEGER NOT NULL,
    "status" "RotationStatus" NOT NULL DEFAULT 'draft',
    "first_due_date" DATE,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rotation_slots" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "rotation_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "SlotStatus" NOT NULL DEFAULT 'scheduled',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rotation_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cycles" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "rotation_id" UUID,
    "cycle_number" INTEGER NOT NULL,
    "due_date" DATE NOT NULL,
    "amount_due" INTEGER NOT NULL,
    "payout_slot_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cycles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rotations_group_id_rotation_number_key" ON "rotations"("group_id", "rotation_number");

-- CreateIndex
CREATE UNIQUE INDEX "rotation_slots_rotation_id_position_key" ON "rotation_slots"("rotation_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "rotation_slots_rotation_id_member_id_key" ON "rotation_slots"("rotation_id", "member_id");

-- CreateIndex
CREATE INDEX "cycles_group_id_due_date_idx" ON "cycles"("group_id", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "cycles_rotation_id_cycle_number_key" ON "cycles"("rotation_id", "cycle_number");

-- AddForeignKey
ALTER TABLE "rotations" ADD CONSTRAINT "rotations_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rotations" ADD CONSTRAINT "rotations_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rotation_slots" ADD CONSTRAINT "rotation_slots_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rotation_slots" ADD CONSTRAINT "rotation_slots_rotation_id_fkey" FOREIGN KEY ("rotation_id") REFERENCES "rotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rotation_slots" ADD CONSTRAINT "rotation_slots_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_rotation_id_fkey" FOREIGN KEY ("rotation_id") REFERENCES "rotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_payout_slot_id_fkey" FOREIGN KEY ("payout_slot_id") REFERENCES "rotation_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Row-level security (hand-written). Each table is visible and writable only inside its
-- organisation's context. No DELETE policies: rotations, slots, and cycles are never deleted.
ALTER TABLE "rotations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rotation_slots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cycles" ENABLE ROW LEVEL SECURITY;

CREATE POLICY rotations_select ON "rotations" FOR SELECT USING (organisation_id = app_current_org());
CREATE POLICY rotations_insert ON "rotations" FOR INSERT WITH CHECK (organisation_id = app_current_org());
CREATE POLICY rotations_update ON "rotations" FOR UPDATE
  USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());

CREATE POLICY rotation_slots_select ON "rotation_slots" FOR SELECT USING (organisation_id = app_current_org());
CREATE POLICY rotation_slots_insert ON "rotation_slots" FOR INSERT WITH CHECK (organisation_id = app_current_org());
CREATE POLICY rotation_slots_update ON "rotation_slots" FOR UPDATE
  USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());

CREATE POLICY cycles_select ON "cycles" FOR SELECT USING (organisation_id = app_current_org());
CREATE POLICY cycles_insert ON "cycles" FOR INSERT WITH CHECK (organisation_id = app_current_org());
CREATE POLICY cycles_update ON "cycles" FOR UPDATE
  USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());

-- Backfill: rotating groups created before this migration get draft rotation 1, with one
-- slot per member in join order. Runs as the owner, so RLS does not apply here.
INSERT INTO "rotations" ("id", "organisation_id", "group_id", "rotation_number", "status")
SELECT gen_random_uuid(), g."organisation_id", g."id", 1, 'draft'
FROM "groups" g
WHERE g."type" = 'rotating';

INSERT INTO "rotation_slots" ("id", "organisation_id", "rotation_id", "member_id", "position")
SELECT gen_random_uuid(), m."organisation_id", r."id", m."id",
       ROW_NUMBER() OVER (PARTITION BY m."group_id" ORDER BY m."join_order")
FROM "members" m
JOIN "rotations" r ON r."group_id" = m."group_id" AND r."rotation_number" = 1;
