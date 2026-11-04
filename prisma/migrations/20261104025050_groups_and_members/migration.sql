-- CreateEnum
CREATE TYPE "GroupType" AS ENUM ('rotating', 'fixed');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('daily', 'weekly', 'monthly');

-- CreateEnum
CREATE TYPE "GroupStatus" AS ENUM ('active', 'paused', 'closed');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('active', 'inactive');

-- CreateTable
CREATE TABLE "groups" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GroupType" NOT NULL,
    "contribution_amount" INTEGER NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "start_date" DATE,
    "status" "GroupStatus" NOT NULL DEFAULT 'active',
    "reminder_offsets" INTEGER[],
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "join_order" INTEGER NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'active',
    "inactive_from" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_officers" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_officers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "groups_organisation_id_created_at_idx" ON "groups"("organisation_id", "created_at");

-- CreateIndex
CREATE INDEX "members_organisation_id_phone_number_idx" ON "members"("organisation_id", "phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "members_group_id_phone_number_key" ON "members"("group_id", "phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "members_group_id_join_order_key" ON "members"("group_id", "join_order");

-- CreateIndex
CREATE INDEX "group_officers_user_id_idx" ON "group_officers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "group_officers_group_id_user_id_key" ON "group_officers"("group_id", "user_id");

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_officers" ADD CONSTRAINT "group_officers_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_officers" ADD CONSTRAINT "group_officers_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_officers" ADD CONSTRAINT "group_officers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-level security (hand-written). Each table is visible and writable only inside its
-- organisation's context. Which groups a role may see is an application rule on top of this.
ALTER TABLE "groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "group_officers" ENABLE ROW LEVEL SECURITY;

CREATE POLICY groups_select ON "groups" FOR SELECT USING (organisation_id = app_current_org());
CREATE POLICY groups_insert ON "groups" FOR INSERT WITH CHECK (organisation_id = app_current_org());
CREATE POLICY groups_update ON "groups" FOR UPDATE
  USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());

CREATE POLICY members_select ON "members" FOR SELECT USING (organisation_id = app_current_org());
CREATE POLICY members_insert ON "members" FOR INSERT WITH CHECK (organisation_id = app_current_org());
CREATE POLICY members_update ON "members" FOR UPDATE
  USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());

CREATE POLICY group_officers_select ON "group_officers" FOR SELECT USING (organisation_id = app_current_org());
CREATE POLICY group_officers_insert ON "group_officers" FOR INSERT WITH CHECK (organisation_id = app_current_org());
CREATE POLICY group_officers_update ON "group_officers" FOR UPDATE
  USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
-- Unassigning an officer deletes the assignment row; no other table here allows DELETE.
CREATE POLICY group_officers_delete ON "group_officers" FOR DELETE USING (organisation_id = app_current_org());
