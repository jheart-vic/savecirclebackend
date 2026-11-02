import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { requireOrgRole } from "../organisations/organisations.middleware.js";
import * as staffController from "./staff.controller.js";

// Mounted on the org-scoped router, so requireAuth and requireOrgMember have already run.
export const staffRouter = Router();

const manageStaff = requireOrgRole("owner", "admin");

staffRouter.post("/invites", manageStaff, staffController.createInvite);
staffRouter.get("/invites", manageStaff, staffController.listInvites);
staffRouter.delete("/invites/:inviteId", manageStaff, staffController.revokeInvite);
staffRouter.get("/staff", manageStaff, staffController.listStaff);
staffRouter.patch("/staff/:membershipId", manageStaff, staffController.changeRole);
staffRouter.delete("/staff/:membershipId", manageStaff, staffController.removeStaff);

// The invitee's side, mounted at /invites: any signed-in user, matched by their own phone.
export const invitesRouter = Router();

invitesRouter.get("/", requireAuth, staffController.listMyInvites);
invitesRouter.post("/:inviteId/accept", requireAuth, staffController.acceptInvite);
invitesRouter.post("/:inviteId/decline", requireAuth, staffController.declineInvite);
