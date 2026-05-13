import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  activityLog,
  approvals,
  companies,
  companyMemberships,
  createDb,
  issueApprovals,
  issues,
  notificationInboxItems,
  workflowInstances,
  workflowParticipants,
  workflowStageInstances,
  workflowTemplates,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { notificationInboxRoutes } from "../routes/notification-inbox.ts";
import { workflowRoutes } from "../routes/workflows.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres workflow notification inbox route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("workflow notification inbox routes", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("workflow-notification-inbox-routes");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(notificationInboxItems);
    await db.delete(workflowParticipants);
    await db.delete(workflowStageInstances);
    await db.delete(workflowInstances);
    await db.delete(workflowTemplates);
    await db.delete(issueApprovals);
    await db.delete(approvals);
    await db.delete(issues);
    await db.delete(companyMemberships);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function createApp(companyId: string) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as any).actor = {
        type: "board",
        userId: "local-board",
        companyIds: [companyId],
        memberships: [{ companyId, membershipRole: "owner", status: "active" }],
        source: "local_implicit",
        isInstanceAdmin: true,
      };
      next();
    });
    app.use("/api", workflowRoutes(db));
    app.use("/api", notificationInboxRoutes(db));
    app.use(errorHandler);
    return app;
  }

  async function seedIssue() {
    const companyId = randomUUID();
    const issueId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "RouteCo",
      status: "active",
      issuePrefix: "RTE",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: "local-board",
      status: "active",
      membershipRole: "owner",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Route workflow task",
      status: "todo",
      priority: "medium",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return { companyId, issueId };
  }

  it("links workflow start and decision routes to durable notification inbox routes", async () => {
    const { companyId, issueId } = await seedIssue();
    const app = createApp(companyId);

    const start = await request(app)
      .post(`/api/issues/${issueId}/workflows?companyId=${companyId}`)
      .send({
        triggerKind: "manual",
        stages: [{
          key: "review",
          type: "review",
          requiredDecisions: 1,
          participants: [{ principalType: "user", principalId: "local-board", role: "reviewer" }],
        }],
      });

    expect(start.status, JSON.stringify(start.body)).toBe(201);

    const inbox = await request(app)
      .get(`/api/companies/${companyId}/notification-inbox?status=unread`);

    expect(inbox.status, JSON.stringify(inbox.body)).toBe(200);
    expect(inbox.body).toHaveLength(1);
    expect(inbox.body[0]).toMatchObject({
      companyId,
      recipientType: "user",
      recipientId: "local-board",
      subjectType: "workflow_stage_instance",
      status: "unread",
      requiresAction: true,
    });

    const read = await request(app)
      .post(`/api/notification-inbox-items/${inbox.body[0].id}/read`)
      .send({ companyId });
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    expect(read.body.status).toBe("read");

    const workflows = await request(app)
      .get(`/api/issues/${issueId}/workflows?companyId=${companyId}`);
    const stageId = workflows.body[0].stages[0].id;

    const decision = await request(app)
      .post(`/api/workflow-stages/${stageId}/decisions`)
      .send({ decision: "approved", note: "done" });
    expect(decision.status, JSON.stringify(decision.body)).toBe(200);

    const handled = await request(app)
      .get(`/api/companies/${companyId}/notification-inbox`);
    expect(handled.body[0]).toMatchObject({ id: inbox.body[0].id, status: "handled" });
  });
});
