import type { Request, Response } from "express";
import { currentAuth } from "../auth/auth.middleware.js";
import { requirePhone } from "../auth/auth.validation.js";
import { currentOrg } from "../organisations/organisations.middleware.js";
import { parse } from "../validate.js";
import * as staffService from "./staff.service.js";
import { changeRoleBody, createInviteBody, inviteParams, staffParams } from "./staff.validation.js";

export async function createInvite(req: Request, res: Response) {
  const { phone, role } = parse(createInviteBody, req.body);
  const { user } = currentAuth(res);
  const { organisationId } = currentOrg(res);
  const result = await staffService.createInvite(organisationId, user, requirePhone(phone), role);
  res.status(201).json(result);
}

export async function listInvites(_req: Request, res: Response) {
  const { user } = currentAuth(res);
  const { organisationId } = currentOrg(res);
  res.json({ invites: await staffService.listInvites(organisationId, user.id) });
}

export async function revokeInvite(req: Request, res: Response) {
  const { inviteId } = parse(inviteParams, req.params, "params");
  const { user } = currentAuth(res);
  const { organisationId } = currentOrg(res);
  await staffService.revokeInvite(organisationId, user.id, inviteId);
  res.status(204).end();
}

export async function listMyInvites(_req: Request, res: Response) {
  res.json({ invites: await staffService.listMyInvites(currentAuth(res).user) });
}

export async function acceptInvite(req: Request, res: Response) {
  const { inviteId } = parse(inviteParams, req.params, "params");
  res.json(await staffService.acceptInvite(currentAuth(res).user, inviteId));
}

export async function declineInvite(req: Request, res: Response) {
  const { inviteId } = parse(inviteParams, req.params, "params");
  await staffService.declineInvite(currentAuth(res).user, inviteId);
  res.status(204).end();
}

export async function listStaff(_req: Request, res: Response) {
  const { user } = currentAuth(res);
  const { organisationId } = currentOrg(res);
  res.json({ staff: await staffService.listStaff(organisationId, user.id) });
}

export async function changeRole(req: Request, res: Response) {
  const { membershipId } = parse(staffParams, req.params, "params");
  const { role } = parse(changeRoleBody, req.body);
  const { user } = currentAuth(res);
  const { organisationId } = currentOrg(res);
  await staffService.changeRole(organisationId, user.id, membershipId, role);
  res.json({ membershipId, role });
}

export async function removeStaff(req: Request, res: Response) {
  const { membershipId } = parse(staffParams, req.params, "params");
  const { user } = currentAuth(res);
  const { organisationId } = currentOrg(res);
  await staffService.removeStaff(organisationId, user.id, membershipId);
  res.status(204).end();
}
