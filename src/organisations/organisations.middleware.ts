import type { NextFunction, Request, RequestHandler, Response } from "express";
import { currentAuth } from "../auth/auth.middleware.js";
import { AppError } from "../errors.js";
import type { OrgRole } from "../generated/prisma/enums.js";
import { parse } from "../validate.js";
import * as orgService from "./organisations.service.js";
import { orgParams } from "./organisations.validation.js";

export type OrgContext = { organisationId: string; membershipId: string; role: OrgRole };

declare global {
  namespace Express {
    interface Locals {
      org?: OrgContext;
    }
  }
}

/** Lets a request into `/organisations/:orgId` only for an active member; everyone else gets 404. */
export async function requireOrgMember(req: Request, res: Response, next: NextFunction) {
  const { orgId } = parse(orgParams, req.params, "params");
  const { user } = currentAuth(res);
  const membership = await orgService.findActiveMembership(orgId, user.id);
  if (!membership) throw orgService.organisationNotFound();
  res.locals.org = { organisationId: orgId, membershipId: membership.id, role: membership.role };
  next();
}

/** The organisation context; only valid on routes behind requireOrgMember. */
export function currentOrg(res: Response): OrgContext {
  if (!res.locals.org) throw new Error("currentOrg used on a route without requireOrgMember");
  return res.locals.org;
}

/** Lets the request through only when the caller's role in this organisation is one of `roles`. */
export function requireOrgRole(...roles: OrgRole[]): RequestHandler {
  return (_req, res, next) => {
    if (!roles.includes(currentOrg(res).role)) {
      throw new AppError(403, "forbidden", "Your role cannot do this");
    }
    next();
  };
}
