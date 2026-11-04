import type { Request, Response } from "express";
import { currentAuth } from "../auth/auth.middleware.js";
import { requirePhone } from "../auth/auth.validation.js";
import { AppError } from "../errors.js";
import { currentOrg } from "../organisations/organisations.middleware.js";
import { parse } from "../validate.js";
import * as groupService from "./groups.service.js";
import { addMemberBody, assignOfficerBody, createGroupBody, groupParams, officerParams } from "./groups.validation.js";

const actorOf = (res: Response): groupService.Actor => {
  const { organisationId, role } = currentOrg(res);
  return { organisationId, role, userId: currentAuth(res).user.id };
};

export async function create(req: Request, res: Response) {
  const input = parse(createGroupBody, req.body);
  res.status(201).json({ group: await groupService.createGroup(actorOf(res), input) });
}

export async function list(_req: Request, res: Response) {
  res.json({ groups: await groupService.listGroups(actorOf(res)) });
}

export async function show(req: Request, res: Response) {
  const { groupId } = parse(groupParams, req.params, "params");
  res.json(await groupService.getGroup(actorOf(res), groupId));
}

export async function assignOfficer(req: Request, res: Response) {
  const { groupId } = parse(groupParams, req.params, "params");
  const { userId } = parse(assignOfficerBody, req.body);
  res.status(201).json({ officer: await groupService.assignOfficer(actorOf(res), groupId, userId) });
}

export async function unassignOfficer(req: Request, res: Response) {
  const { groupId, userId } = parse(officerParams, req.params, "params");
  await groupService.unassignOfficer(actorOf(res), groupId, userId);
  res.status(204).end();
}

export async function addMember(req: Request, res: Response) {
  const { groupId } = parse(groupParams, req.params, "params");
  const { name, phone } = parse(addMemberBody, req.body);
  const member = await groupService.addMember(actorOf(res), groupId, { name, phoneNumber: requirePhone(phone) });
  res.status(201).json({ member });
}

export async function importMembers(req: Request, res: Response) {
  const { groupId } = parse(groupParams, req.params, "params");
  if (!req.is("text/csv") || typeof req.body !== "string") {
    throw new AppError(415, "unsupported_media_type", "Send the file as text/csv");
  }
  res.status(201).json({ members: await groupService.importMembers(actorOf(res), groupId, req.body) });
}
