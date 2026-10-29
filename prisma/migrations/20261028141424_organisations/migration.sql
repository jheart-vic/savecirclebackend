-- CreateEnum
CREATE TYPE "OrganisationType" AS ENUM ('cooperative', 'business', 'informal');

-- CreateEnum
CREATE TYPE "MoneyMode" AS ENUM ('gateway', 'ledger');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('owner', 'admin', 'treasurer', 'branch_manager', 'field_officer');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('active');

-- CreateTable
CREATE TABLE "organisations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrganisationType" NOT NULL,
    "contact_email" TEXT,
    "contact_phone" TEXT NOT NULL,
    "money_mode" "MoneyMode" NOT NULL DEFAULT 'ledger',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_memberships" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "OrgRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "org_memberships_user_id_idx" ON "org_memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "org_memberships_organisation_id_user_id_key" ON "org_memberships"("organisation_id", "user_id");

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-level security (hand-written). The app connects as savecircle_app, which cannot
-- bypass these policies. Each request sets app.organisation_id and app.user_id with
-- set_config(..., true) inside its transaction; an unset value means no rows, never an error.
CREATE FUNCTION app_current_org() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.organisation_id', true), '')::uuid $$;
CREATE FUNCTION app_current_user() RETURNS uuid LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

ALTER TABLE "organisations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org_memberships" ENABLE ROW LEVEL SECURITY;

-- An organisation is visible inside its own context, or to any user with an active membership in it.
CREATE POLICY organisations_select ON "organisations" FOR SELECT
  USING (
    id = app_current_org()
    OR EXISTS (
      SELECT 1 FROM "org_memberships" m
      WHERE m.organisation_id = "organisations".id
        AND m.user_id = app_current_user()
        AND m.status = 'active'
    )
  );
CREATE POLICY organisations_insert ON "organisations" FOR INSERT
  WITH CHECK (id = app_current_org());
CREATE POLICY organisations_update ON "organisations" FOR UPDATE
  USING (id = app_current_org()) WITH CHECK (id = app_current_org());

-- Memberships are visible inside their organisation's context, or to the member themselves.
CREATE POLICY org_memberships_select ON "org_memberships" FOR SELECT
  USING (organisation_id = app_current_org() OR user_id = app_current_user());
CREATE POLICY org_memberships_insert ON "org_memberships" FOR INSERT
  WITH CHECK (organisation_id = app_current_org());
CREATE POLICY org_memberships_update ON "org_memberships" FOR UPDATE
  USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
-- No DELETE policies: tenant rows are never deleted by the app.
