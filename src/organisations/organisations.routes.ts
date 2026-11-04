import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import { groupsRouter } from "../groups/groups.routes.js";
import { staffRouter } from "../staff/staff.routes.js";
import * as orgController from "./organisations.controller.js";
import { requireOrgMember, requireOrgRole } from "./organisations.middleware.js";

export const organisationsRouter = Router();

// Every route on this router is behind requireOrgMember, so none can forget the check.
const orgScopedRouter = Router({ mergeParams: true });

organisationsRouter.post("/", requireAuth, orgController.create);
organisationsRouter.get("/", requireAuth, orgController.list);
organisationsRouter.use("/:orgId", requireAuth, requireOrgMember, orgScopedRouter);

orgScopedRouter.get("/", orgController.show);
orgScopedRouter.get("/policy", requireOrgRole("owner", "admin"), orgController.showPolicy);
orgScopedRouter.patch("/policy", requireOrgRole("owner", "admin"), orgController.updatePolicy);
orgScopedRouter.use(staffRouter);
orgScopedRouter.use(groupsRouter);
