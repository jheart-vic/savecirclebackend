import type { Request, Response } from "express";
import { currentAuth } from "../auth/auth.middleware.js";
import { requirePhone } from "../auth/auth.validation.js";
import { parse } from "../validate.js";
import { currentOrg } from "./organisations.middleware.js";
import * as orgService from "./organisations.service.js";
import { createOrganisationBody, updatePolicyBody } from "./organisations.validation.js";

export async function create(req: Request, res: Response) {
  const { name, type, contactPhone, contactEmail } = parse(createOrganisationBody, req.body);
  const { user } = currentAuth(res);
  const result = await orgService.createOrganisation(user.id, {
    name,
    type,
    contactPhone: requirePhone(contactPhone),
    contactEmail: contactEmail ?? null,
  });
  res.status(201).json(result);
}

export async function list(_req: Request, res: Response) {
  const { user } = currentAuth(res);
  res.json({ organisations: await orgService.listOrganisations(user.id) });
}

export async function showPolicy(_req: Request, res: Response) {
  const { user } = currentAuth(res);
  const { organisationId } = currentOrg(res);
  res.json({ policy: await orgService.getPolicy(organisationId, user.id) });
}

export async function updatePolicy(req: Request, res: Response) {
  const { sessionTtlDays } = parse(updatePolicyBody, req.body);
  const { user } = currentAuth(res);
  const { organisationId } = currentOrg(res);
  res.json({ policy: await orgService.setSessionTtlDays(organisationId, user.id, sessionTtlDays) });
}

export async function show(_req: Request, res: Response) {
  const { user } = currentAuth(res);
  const { organisationId, role } = currentOrg(res);
  res.json({ organisation: await orgService.getOrganisation(organisationId, user.id), role });
}
