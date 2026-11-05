import { Router } from "express";
import * as rotationController from "./rotations.controller.js";

// Mounted on the org-scoped router; who may see or change the group is decided in the service.
export const rotationsRouter = Router();

rotationsRouter.get("/groups/:groupId/rotation", rotationController.show);
rotationsRouter.put("/groups/:groupId/rotation/order", rotationController.reorder);
rotationsRouter.post("/groups/:groupId/rotation/start", rotationController.start);
