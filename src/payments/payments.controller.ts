import type { Request, Response } from "express";
import { currentAuth } from "../auth/auth.middleware.js";
import type { Actor } from "../groups/groups.service.js";
import { currentOrg } from "../organisations/organisations.middleware.js";
import { parse } from "../validate.js";
import * as paymentService from "./payments.service.js";
import { logCashBody, memberParams } from "./payments.validation.js";

const actorOf = (res: Response): Actor => {
  const { organisationId, role } = currentOrg(res);
  return { organisationId, role, userId: currentAuth(res).user.id };
};

export async function logCash(req: Request, res: Response) {
  const { groupId, memberId } = parse(memberParams, req.params, "params");
  const { amount, note } = parse(logCashBody, req.body);
  const result = await paymentService.logCash(actorOf(res), groupId, memberId, { amount, note: note ?? null });
  res.status(201).json(result);
}
