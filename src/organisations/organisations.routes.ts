import { Router } from "express";
import { requireAuth } from "../auth/auth.middleware.js";
import * as orgController from "./organisations.controller.js";
import { requireOrgMember } from "./organisations.middleware.js";

export const organisationsRouter = Router();

organisationsRouter.post("/", requireAuth, orgController.create);
organisationsRouter.get("/", requireAuth, orgController.list);
organisationsRouter.get("/:orgId", requireAuth, requireOrgMember, orgController.show);
