import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { startIssueWorkflowSchema, workflowDecisionSchema } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity, workflowService } from "../services/index.js";

export function workflowRoutes(db: Db) {
  const router = Router();
  const svc = workflowService(db);

  router.get("/issues/:issueId/workflows", async (req, res) => {
    const issueId = req.params.issueId as string;
    const companyId = req.query.companyId as string | undefined;
    if (!companyId) {
      res.status(400).json({ error: "companyId query parameter is required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const workflows = await svc.listSubjectWorkflows(companyId, "issue", issueId);
    if (!workflows) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    res.json(workflows);
  });

  router.post("/issues/:issueId/workflows", validate(startIssueWorkflowSchema), async (req, res) => {
    const issueId = req.params.issueId as string;
    const companyId = req.query.companyId as string | undefined;
    if (!companyId) {
      res.status(400).json({ error: "companyId query parameter is required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const workflow = await svc.startIssueWorkflow(companyId, issueId, req.body, {
      actorType: actor.actorType === "agent" ? "agent" : "user",
      actorId: actor.actorId,
      agentId: actor.agentId,
    });
    if (!workflow) {
      res.status(422).json({ error: "Invalid workflow payload" });
      return;
    }
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "workflow.created",
      entityType: "workflow_instance",
      entityId: workflow.id,
      details: { subjectType: "issue", subjectId: issueId, currentStageKey: workflow.currentStageKey },
    });
    res.status(201).json(workflow);
  });

  router.post("/workflow-stages/:stageId/decisions", validate(workflowDecisionSchema), async (req, res) => {
    const stageId = req.params.stageId as string;
    const row = await svc.getStageWithInstance(stageId);
    if (!row) {
      res.status(404).json({ error: "Workflow stage not found" });
      return;
    }
    assertCompanyAccess(req, row.stage.companyId);
    const actor = getActorInfo(req);
    const result = await svc.decideStage(stageId, req.body, {
      actorType: actor.actorType === "agent" ? "agent" : "user",
      actorId: actor.actorId,
      agentId: actor.agentId,
    });
    if (!result) {
      res.status(404).json({ error: "Workflow stage not found" });
      return;
    }
    if ("error" in result) {
      const status = result.error === "not_participant" ? 403 : 409;
      res.status(status).json({ error: result.error });
      return;
    }
    await logActivity(db, {
      companyId: row.stage.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "workflow.stage_decided",
      entityType: "workflow_stage_instance",
      entityId: stageId,
      details: {
        workflowInstanceId: row.instance.id,
        decision: req.body.decision,
        advancedToStageKey: result.advanced?.nextStage?.stageKey ?? null,
        completed: result.advanced?.completed ?? false,
      },
    });
    if (result.row.stage.approvalId) {
      const action = req.body.decision === "approved"
        ? "approval.approved"
        : req.body.decision === "rejected"
          ? "approval.rejected"
          : "approval.revision_requested";
      await logActivity(db, {
        companyId: row.stage.companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action,
        entityType: "approval",
        entityId: result.row.stage.approvalId,
        details: {
          source: "workflow",
          workflowInstanceId: row.instance.id,
          workflowStageId: stageId,
          decision: req.body.decision,
        },
      });
    }
    res.json(result);
  });

  return router;
}
