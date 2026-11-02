-- AlterEnum
ALTER TYPE "MembershipStatus" ADD VALUE 'removed';

-- CreateTable
CREATE TABLE "staff_invites" (
    "id" UUID NOT NULL,
    "organisation_id" UUID NOT NULL,
    "phone_number" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "invited_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "declined_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_invites_organisation_id_phone_number_idx" ON "staff_invites"("organisation_id", "phone_number");

-- CreateIndex
CREATE INDEX "staff_invites_phone_number_idx" ON "staff_invites"("phone_number");

-- AddForeignKey
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_organisation_id_fkey" FOREIGN KEY ("organisation_id") REFERENCES "organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_invites" ADD CONSTRAINT "staff_invites_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-level security (hand-written). An invite is visible to its organisation, and to the
-- signed-in user whose phone it was sent to while it is still pending.
CREATE FUNCTION app_current_phone() RETURNS text LANGUAGE sql STABLE
  AS $$ SELECT phone_number FROM users WHERE id = app_current_user() $$;

ALTER TABLE "staff_invites" ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_invites_select ON "staff_invites" FOR SELECT
  USING (
    organisation_id = app_current_org()
    OR (
      phone_number = app_current_phone()
      AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL
      AND expires_at > now()
    )
  );
CREATE POLICY staff_invites_insert ON "staff_invites" FOR INSERT
  WITH CHECK (organisation_id = app_current_org());
CREATE POLICY staff_invites_update ON "staff_invites" FOR UPDATE
  USING (organisation_id = app_current_org()) WITH CHECK (organisation_id = app_current_org());
-- No DELETE policy: invites are revoked, never deleted.

-- An invitee may also read the inviting organisation (the API returns only its id and name).
DROP POLICY organisations_select ON "organisations";
CREATE POLICY organisations_select ON "organisations" FOR SELECT
  USING (
    id = app_current_org()
    OR EXISTS (
      SELECT 1 FROM "org_memberships" m
      WHERE m.organisation_id = "organisations".id
        AND m.user_id = app_current_user()
        AND m.status = 'active'
    )
    OR EXISTS (
      SELECT 1 FROM "staff_invites" i
      WHERE i.organisation_id = "organisations".id
        AND i.phone_number = app_current_phone()
        AND i.accepted_at IS NULL AND i.declined_at IS NULL AND i.revoked_at IS NULL
        AND i.expires_at > now()
    )
  );
