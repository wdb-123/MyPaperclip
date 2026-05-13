import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  companyMemberships,
  createDb,
  issues,
  workflowInstances,
  workflowParticipants,
  workflowStageInstances,
  workflowTemplates,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { workflowService } from "../services/workflows.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres workflow service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("workflowService governance invariants", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof workflowService>;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("workflow-service");
    stopDb = started.stop;
    db = createDb(started.connectionString);
    svc = workflowService(db);
  });

  afterEach(async () => {
    await db.delete(workflowParticipants);
    await db.delete(workflowStageInstances);
    await db.delete(workflowInstances);
    await db.delete(workflowTemplates);
    await db.delete(issues);
    await db.delete(companyMemberships);
    await db.delete(companies);
  });

  afterAll(async () => {
    await stopDb?.();
  });

  async function seedIssue() {
    const companyId = randomUUID();
    const issueId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "WorkflowCo",
      status: "active",
      issuePrefix: `W${companyId.slice(0, 2).toUpperCase()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: "reviewer-1",
      status: "active",
      membershipRole: "operator",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Governed task",
      status: "todo",
      priority: "medium",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return { companyId, issueId };
  }

  it("rejects user participants without active company membership", async () => {
    const { companyId, issueId } = await seedIssue();

    const workflow = await svc.startIssueWorkflow(companyId, issueId, {
      triggerKind: "manual",
      stages: [{
        key: "review",
        type: "review",
        requiredDecisions: 1,
        participants: [{ principalType: "user", principalId: "not-a-member", role: "reviewer" }],
      }],
    }, { actorType: "user", actorId: "reviewer-1" });

    expect(workflow).toBeNull();
  });

  it("advances each in-progress stage only once", async () => {
    const { companyId, issueId } = await seedIssue();
    const workflow = await svc.startIssueWorkflow(companyId, issueId, {
      triggerKind: "manual",
      stages: [
        {
          key: "review",
          type: "review",
          requiredDecisions: 1,
          participants: [{ principalType: "user", principalId: "reviewer-1", role: "reviewer" }],
        },
        {
          key: "approval",
          type: "approval",
          requiredDecisions: 1,
          participants: [{ principalType: "user", principalId: "reviewer-1", role: "approver" }],
        },
      ],
    }, { actorType: "user", actorId: "reviewer-1" });
    const [initial] = await svc.listSubjectWorkflows(companyId, "issue", issueId) ?? [];
    const reviewStage = initial!.stages.find((stage) => stage.stageKey === "review")!;

    const firstDecision = await svc.decideStage(reviewStage.id, { decision: "approved", note: null }, {
      actorType: "user",
      actorId: "reviewer-1",
    });
    const duplicateDecision = await svc.decideStage(reviewStage.id, { decision: "approved", note: null }, {
      actorType: "user",
      actorId: "reviewer-1",
    });
    const [afterReview] = await svc.listSubjectWorkflows(companyId, "issue", issueId) ?? [];

    expect(workflow).not.toBeNull();
    expect(firstDecision && "advanced" in firstDecision ? firstDecision.advanced?.nextStage?.stageKey : null).toBe("approval");
    expect(duplicateDecision).toMatchObject({ error: "stage_not_in_progress" });
    expect(afterReview?.currentStageKey).toBe("approval");
    expect(afterReview?.stages.find((stage) => stage.stageKey === "review")?.status).toBe("approved");
    expect(afterReview?.stages.find((stage) => stage.stageKey === "approval")?.status).toBe("in_progress");
  });
});
