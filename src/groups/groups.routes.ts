import express, { Router } from "express";
import { requireOrgRole } from "../organisations/organisations.middleware.js";
import * as groupController from "./groups.controller.js";

// Mounted on the org-scoped router, so requireAuth and requireOrgMember have already run.
// Which groups a role can see is decided in the service.
export const groupsRouter = Router();

const createsGroups = requireOrgRole("owner", "admin", "field_officer");
const managesOfficers = requireOrgRole("owner", "admin");
const csvBody = express.text({ type: "text/csv", limit: "100kb" });

groupsRouter.post("/groups", createsGroups, groupController.create);
groupsRouter.get("/groups", groupController.list);
groupsRouter.get("/groups/:groupId", groupController.show);
groupsRouter.post("/groups/:groupId/officers", managesOfficers, groupController.assignOfficer);
groupsRouter.delete("/groups/:groupId/officers/:userId", managesOfficers, groupController.unassignOfficer);
groupsRouter.post("/groups/:groupId/members", createsGroups, groupController.addMember);
groupsRouter.post("/groups/:groupId/members/import", createsGroups, csvBody, groupController.importMembers);
