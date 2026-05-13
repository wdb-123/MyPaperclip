import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  approvals,
  companyMemberships,
  issueApprovals,
  issues,
  positionAssignments,
  positions,
  workflowInstances,
  workflowParticipants,
  workflowStageInstances,
  workflowTemplates,
} from "@paperclipai/db";
import type { StartIssueWorkflow, WorkflowDecisionInput } from "@paperclipai/shared";

type ActorInput = {
  actorType: "agent" | "user";
  actorId: string;
  agentId?: string | null;
};

export function workflowService(db: Db) {
  // TODO(workflow-governance): Approval stages must create or link approvals
  // and derive stage progress from approval status instead of treating
  // workflowParticipants.decision as the source of truth.
  async function assertSubjectInCompany(subjectType: string, subjectId: string, companyId: string) {
    if (subjectType === "issue") {
      const [row] = await db
        .select({ id: issues.id })
        .from(issues)
        .where(and(eq(issues.id, subjectId), eq(issues.companyId, companyId)))
        .limit(1);
      return Boolean(row);
    }
    if (subjectType === "approval") {
      const [row] = await db
        .select({ id: approvals.id })
        .from(approvals)
        .where(and(eq(approvals.id, subjectId), eq(approvals.companyId, companyId)))
        .limit(1);
      return Boolean(row);
    }
    return false;
  }

  async function assertParticipantInCompany(companyId: string, principalType: string, principalId: string) {
    if (principalType === "agent") {
      const [row] = await db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.id, principalId), eq(agents.companyId, companyId)))
        .limit(1);
      return Boolean(row);
    }
    if (principalType === "position") {
      const [row] = await db
        .select({ id: positions.id })
        .from(positions)
        .where(and(eq(positions.id, principalId), eq(positions.companyId, companyId)))
        .limit(1);
      return Boolean(row);
    }
    if (principalType === "user") {
      const [row] = await db
        .select({ id: companyMemberships.id })
        .from(companyMemberships)
        .where(and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.principalId, principalId),
          eq(companyMemberships.status, "active"),
        ))
        .limit(1);
      return Boolean(row);
    }
    return false;
  }

  async function getStageWithInstance(stageId: string) {
    const [row] = await db
      .select({
        stage: workflowStageInstances,
        instance: workflowInstances,
      })
      .from(workflowStageInstances)
      .innerJoin(workflowInstances, eq(workflowStageInstances.workflowInstanceId, workflowInstances.id))
      .where(eq(workflowStageInstances.id, stageId))
      .limit(1);
    return row ?? null;
  }

  return {
    async startIssueWorkflow(companyId: string, issueId: string, input: StartIssueWorkflow, actor: ActorInput) {
      if (!(await assertSubjectInCompany("issue", issueId, companyId))) return null;
      if (input.templateId) {
        const [template] = await db
          .select({ id: workflowTemplates.id })
          .from(workflowTemplates)
          .where(and(eq(workflowTemplates.id, input.templateId), eq(workflowTemplates.companyId, companyId)))
          .limit(1);
        if (!template) return null;
      }
      for (const stage of input.stages) {
        for (const participant of stage.participants) {
          if (!(await assertParticipantInCompany(companyId, participant.principalType, participant.principalId))) {
            return null;
          }
        }
      }

      return db.transaction(async (tx) => {
        const firstStage = input.stages[0]!;
        const [instance] = await tx
          .insert(workflowInstances)
          .values({
            companyId,
            templateId: input.templateId ?? null,
            subjectType: "issue",
            subjectId: issueId,
            status: "active",
            currentStageKey: firstStage.key,
            createdByUserId: actor.actorType === "user" ? actor.actorId : null,
            createdByAgentId: actor.actorType === "agent" ? actor.actorId : null,
          })
          .returning();
        if (!instance) throw new Error("Failed to create workflow instance");

        for (let index = 0; index < input.stages.length; index += 1) {
          const stage = input.stages[index]!;
          const [approval] = stage.type === "approval"
            ? await tx
              .insert(approvals)
              .values({
                companyId,
                type: "request_board_approval",
                requestedByUserId: actor.actorType === "user" ? actor.actorId : null,
                requestedByAgentId: actor.actorType === "agent" ? actor.actorId : null,
                status: "pending",
                payload: {
                  source: "workflow",
                  workflowInstanceId: instance.id,
                  issueId,
                  stageKey: stage.key,
                },
                decisionNote: null,
                decidedByUserId: null,
                decidedAt: null,
                updatedAt: new Date(),
              })
              .returning()
            : [null];
          const [createdStage] = await tx
            .insert(workflowStageInstances)
            .values({
              companyId,
              workflowInstanceId: instance.id,
              stageKey: stage.key,
              stageType: stage.type,
              stageOrder: index,
              approvalId: approval?.id ?? null,
              status: index === 0 ? "in_progress" : "pending",
              requiredDecisions: stage.requiredDecisions,
              dueAt: stage.dueAt ? new Date(stage.dueAt) : null,
            })
            .returning();
          if (!createdStage) throw new Error("Failed to create workflow stage");

          if (approval) {
            await tx
              .insert(issueApprovals)
              .values({
                companyId,
                issueId,
                approvalId: approval.id,
                linkedByAgentId: actor.actorType === "agent" ? actor.actorId : null,
                linkedByUserId: actor.actorType === "user" ? actor.actorId : null,
              })
              .onConflictDoNothing();
          }

          await tx.insert(workflowParticipants).values(stage.participants.map((participant) => ({
            companyId,
            stageInstanceId: createdStage.id,
            principalType: participant.principalType,
            principalId: participant.principalId,
            role: participant.role ?? (stage.type === "approval" ? "approver" : "reviewer"),
          })));
        }

        return instance;
      });
    },

    async listSubjectWorkflows(companyId: string, subjectType: string, subjectId: string) {
      if (!(await assertSubjectInCompany(subjectType, subjectId, companyId))) return null;
      const instances = await db
        .select()
        .from(workflowInstances)
        .where(and(
          eq(workflowInstances.companyId, companyId),
          eq(workflowInstances.subjectType, subjectType),
          eq(workflowInstances.subjectId, subjectId),
        ))
        .orderBy(asc(workflowInstances.createdAt));
      if (instances.length === 0) return [];
      const instanceIds = instances.map((instance) => instance.id);
      const stages = await db
        .select()
        .from(workflowStageInstances)
        .where(inArray(workflowStageInstances.workflowInstanceId, instanceIds))
        .orderBy(asc(workflowStageInstances.stageOrder), asc(workflowStageInstances.createdAt));
      const stageIds = stages.map((stage) => stage.id);
      const participants = stageIds.length > 0
        ? await db
          .select()
          .from(workflowParticipants)
          .where(inArray(workflowParticipants.stageInstanceId, stageIds))
          .orderBy(asc(workflowParticipants.createdAt))
        : [];
      return instances.map((instance) => ({
        ...instance,
        stages: stages
          .filter((stage) => stage.workflowInstanceId === instance.id)
          .map((stage) => ({
            ...stage,
            participants: participants.filter((participant) => participant.stageInstanceId === stage.id),
          })),
      }));
    },

    async decideStage(stageId: string, input: WorkflowDecisionInput, actor: ActorInput) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            stage: workflowStageInstances,
            instance: workflowInstances,
          })
          .from(workflowStageInstances)
          .innerJoin(workflowInstances, eq(workflowStageInstances.workflowInstanceId, workflowInstances.id))
          .where(eq(workflowStageInstances.id, stageId))
          .limit(1);
        if (!row) return null;
        if (row.stage.status !== "in_progress") return { error: "stage_not_in_progress" as const, row };

        const directPrincipalType = actor.actorType === "agent" ? "agent" : "user";
        const principalIds = new Set<string>([actor.actorId]);
        if (actor.actorType === "user") {
          const occupiedPositions = await tx
            .select({ positionId: positionAssignments.positionId })
            .from(positionAssignments)
            .where(
              and(
                eq(positionAssignments.companyId, row.stage.companyId),
                eq(positionAssignments.principalType, "user"),
                eq(positionAssignments.principalId, actor.actorId),
                eq(positionAssignments.status, "active"),
              ),
            );
          for (const position of occupiedPositions) principalIds.add(position.positionId);
        }

        const participantRows = await tx
          .select({
            id: workflowParticipants.id,
            principalType: workflowParticipants.principalType,
            principalId: workflowParticipants.principalId,
          })
          .from(workflowParticipants)
          .where(eq(workflowParticipants.stageInstanceId, stageId));
        const participantIds = participantRows
          .filter((participant) => {
            if (participant.principalType === directPrincipalType && participant.principalId === actor.actorId) return true;
            return participant.principalType === "position" && principalIds.has(participant.principalId);
          })
          .map((participant) => participant.id);
        if (participantIds.length === 0) return { error: "not_participant" as const, row };

        const now = new Date();
        await tx
          .update(workflowParticipants)
          .set({ decision: input.decision, decisionNote: input.note ?? null, decidedAt: now, updatedAt: now })
          .where(inArray(workflowParticipants.id, participantIds));

        if (input.decision === "revision_requested") {
          if (row.stage.approvalId) {
            await tx
              .update(approvals)
              .set({
                status: "revision_requested",
                decisionNote: input.note ?? null,
                decidedByUserId: actor.actorType === "user" ? actor.actorId : null,
                decidedAt: now,
                updatedAt: now,
              })
              .where(and(eq(approvals.id, row.stage.approvalId), eq(approvals.status, "pending")));
          }
          // TODO(workflow-governance): Define whether revision_requested returns
          // the issue to execution or starts a prior stage after approval integration.
          return { row, advanced: null };
        }

        if (input.decision === "rejected") {
          if (row.stage.approvalId) {
            await tx
              .update(approvals)
              .set({
                status: "rejected",
                decisionNote: input.note ?? null,
                decidedByUserId: actor.actorType === "user" ? actor.actorId : null,
                decidedAt: now,
                updatedAt: now,
              })
              .where(and(eq(approvals.id, row.stage.approvalId), inArray(approvals.status, ["pending", "revision_requested"])));
          }
          const [stage] = await tx
            .update(workflowStageInstances)
            .set({ status: "rejected", completedAt: now, updatedAt: now })
            .where(and(eq(workflowStageInstances.id, stageId), eq(workflowStageInstances.status, "in_progress")))
            .returning();
          if (!stage) return { error: "stage_not_in_progress" as const, row };
          await tx
            .update(workflowInstances)
            .set({ status: "failed", updatedAt: now })
            .where(and(eq(workflowInstances.id, row.instance.id), eq(workflowInstances.status, "active")));
          return { row: { stage, instance: row.instance }, advanced: null };
        }

        const approvedParticipants = await tx
          .select({ id: workflowParticipants.id })
          .from(workflowParticipants)
          .where(and(
            eq(workflowParticipants.stageInstanceId, stageId),
            eq(workflowParticipants.decision, "approved"),
          ));
        if (approvedParticipants.length < row.stage.requiredDecisions) {
          return { row, advanced: null };
        }

        if (row.stage.approvalId) {
          const [approval] = await tx
            .update(approvals)
            .set({
              status: "approved",
              decisionNote: input.note ?? null,
              decidedByUserId: actor.actorType === "user" ? actor.actorId : null,
              decidedAt: now,
              updatedAt: now,
            })
            .where(and(eq(approvals.id, row.stage.approvalId), inArray(approvals.status, ["pending", "revision_requested"])))
            .returning();
          if (!approval) return { error: "stage_not_in_progress" as const, row };
        }

        const [stage] = await tx
          .update(workflowStageInstances)
          .set({ status: "approved", completedAt: now, updatedAt: now })
          .where(and(eq(workflowStageInstances.id, stageId), eq(workflowStageInstances.status, "in_progress")))
          .returning();
        if (!stage) return { error: "stage_not_in_progress" as const, row };

        const stages = await tx
          .select()
          .from(workflowStageInstances)
          .where(eq(workflowStageInstances.workflowInstanceId, row.instance.id))
          .orderBy(asc(workflowStageInstances.stageOrder), asc(workflowStageInstances.createdAt));
        const activeIndex = stages.findIndex((item) => item.id === stageId);
        const next = activeIndex >= 0
          ? stages.slice(activeIndex + 1).find((item) => item.status === "pending")
          : null;

        if (!next) {
          await tx
            .update(workflowInstances)
            .set({ status: "completed", currentStageKey: null, updatedAt: now })
            .where(and(eq(workflowInstances.id, row.instance.id), eq(workflowInstances.status, "active")));
          return { row: { stage, instance: row.instance }, advanced: { completed: true, nextStage: null, current: stage } };
        }

        const [nextStage] = await tx
          .update(workflowStageInstances)
          .set({ status: "in_progress", updatedAt: now })
          .where(and(eq(workflowStageInstances.id, next.id), eq(workflowStageInstances.status, "pending")))
          .returning();
        if (!nextStage) return { error: "stage_not_in_progress" as const, row };
        await tx
          .update(workflowInstances)
          .set({ currentStageKey: nextStage.stageKey, updatedAt: now })
          .where(and(eq(workflowInstances.id, row.instance.id), eq(workflowInstances.status, "active")));
        return { row: { stage, instance: row.instance }, advanced: { completed: false, nextStage, current: stage } };
      });
    },

    async getStageWithInstance(stageId: string) {
      return getStageWithInstance(stageId);
    },
  };
}
