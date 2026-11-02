import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { staffRouter } from "../staff/staff.routes.js";
import * as orgController from "./organisations.controller.js";
import { requireOrgMember } from "./organisations.middleware.js";

export const organisationsRouter = Router();

// Every route on this router is behind requireOrgMember, so none can forget the check.
const orgScopedRouter = Router({ mergeParams: true });

organisationsRouter.post("/", requireAuth, orgController.create);
organisationsRouter.get("/", requireAuth, orgController.list);
organisationsRouter.use("/:orgId", requireAuth, requireOrgMember, orgScopedRouter);

orgScopedRouter.get("/", orgController.show);
orgScopedRouter.use(staffRouter);
