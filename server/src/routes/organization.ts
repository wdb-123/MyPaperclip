import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  createDepartmentSchema,
  createPositionAssignmentSchema,
  createPositionSchema,
  updateDepartmentSchema,
  updatePositionAssignmentSchema,
  updatePositionSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { organizationService, logActivity } from "../services/index.js";

export function organizationRoutes(db: Db) {
  const router = Router();
  const svc = organizationService(db);

  router.get("/companies/:companyId/departments", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.listDepartments(companyId));
  });

  router.post("/companies/:companyId/departments", validate(createDepartmentSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const department = await svc.createDepartment(companyId, req.body);
    if (!department) {
      res.status(422).json({ error: "Invalid department payload" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "department.created",
      entityType: "department",
      entityId: department.id,
      details: { name: department.name, parentDepartmentId: department.parentDepartmentId ?? null },
    });
    res.status(201).json(department);
  });

  router.patch("/departments/:id", validate(updateDepartmentSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getDepartment(id);
    if (!existing) {
      res.status(404).json({ error: "Department not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const department = await svc.updateDepartment(id, req.body);
    if (!department) {
      res.status(422).json({ error: "Invalid department payload" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: department.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "department.updated",
      entityType: "department",
      entityId: department.id,
      details: { name: department.name, status: department.status },
    });
    res.json(department);
  });

  router.get("/companies/:companyId/positions", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.listPositions(companyId));
  });

  router.post("/companies/:companyId/positions", validate(createPositionSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const position = await svc.createPosition(companyId, req.body);
    if (!position) {
      res.status(422).json({ error: "Invalid position payload" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "position.created",
      entityType: "position",
      entityId: position.id,
      details: {
        name: position.name,
        departmentId: position.departmentId ?? null,
        reportsToPositionId: position.reportsToPositionId ?? null,
      },
    });
    res.status(201).json(position);
  });

  router.patch("/positions/:id", validate(updatePositionSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getPosition(id);
    if (!existing) {
      res.status(404).json({ error: "Position not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const position = await svc.updatePosition(id, req.body);
    if (!position) {
      res.status(422).json({ error: "Invalid position payload" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: position.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "position.updated",
      entityType: "position",
      entityId: position.id,
      details: { name: position.name, status: position.status },
    });
    res.json(position);
  });

  router.get("/companies/:companyId/position-assignments", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(await svc.listPositionAssignments(companyId));
  });

  router.post("/companies/:companyId/position-assignments", validate(createPositionAssignmentSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const assignment = await svc.createPositionAssignment(companyId, req.body);
    if (!assignment) {
      res.status(422).json({ error: "Invalid position assignment payload" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "position_assignment.created",
      entityType: "position_assignment",
      entityId: assignment.id,
      details: {
        positionId: assignment.positionId,
        principalType: assignment.principalType,
        principalId: assignment.principalId,
      },
    });
    res.status(201).json(assignment);
  });

  router.patch("/position-assignments/:id", validate(updatePositionAssignmentSchema), async (req, res) => {
    const id = req.params.id as string;
    const existing = await svc.getPositionAssignment(id);
    if (!existing) {
      res.status(404).json({ error: "Position assignment not found" });
      return;
    }
    assertCompanyAccess(req, existing.companyId);
    const body = { ...req.body };
    if (typeof body.endedAt === "string") body.endedAt = new Date(body.endedAt);
    const assignment = await svc.updatePositionAssignment(id, body);
    if (!assignment) {
      res.status(422).json({ error: "Invalid position assignment payload" });
      return;
    }
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: assignment.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "position_assignment.updated",
      entityType: "position_assignment",
      entityId: assignment.id,
      details: { status: assignment.status },
    });
    res.json(assignment);
  });

  return router;
}
