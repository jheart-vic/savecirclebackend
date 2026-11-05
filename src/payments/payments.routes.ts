import { Router } from "express";
import * as paymentController from "./payments.controller.js";

// Mounted on the org-scoped router; who may log cash for a group is decided in the service.
export const paymentsRouter = Router();

paymentsRouter.post("/groups/:groupId/members/:memberId/cash", paymentController.logCash);
