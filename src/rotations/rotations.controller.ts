import type { Request, Response } from "express";
import { currentAuth } from "../auth/auth.middleware.js";
import type { Actor } from "../groups/groups.service.js";
import { groupParams } from "../groups/groups.validation.js";
import { currentOrg } from "../organisations/organisations.middleware.js";
import { parse } from "../validate.js";
import * as rotationService from "./rotations.service.js";
import { reorderBody, startBody } from "./rotations.validation.js";

const actorOf = (res: Response): Actor => {
  const { organisationId, role } = currentOrg(res);
  return { organisationId, role, userId: currentAuth(res).user.id };
};

export async function show(req: Request, res: Response) {
  const { groupId } = parse(groupParams, req.params, "params");
  res.json({ rotation: await rotationService.getRotation(actorOf(res), groupId) });
}

export async function reorder(req: Request, res: Response) {
  const { groupId } = parse(groupParams, req.params, "params");
  const { memberIds } = parse(reorderBody, req.body);
  res.json({ rotation: await rotationService.reorder(actorOf(res), groupId, memberIds) });
}

export async function start(req: Request, res: Response) {
  const { groupId } = parse(groupParams, req.params, "params");
  const { firstDueDate } = parse(startBody, req.body ?? {});
  res.json({ rotation: await rotationService.start(actorOf(res), groupId, firstDueDate) });
}
