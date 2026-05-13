import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  companyMemberships,
  createDb,
  positionAssignments,
  positions,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { issueAssigneeResolutionService } from "../services/issue-assignee-resolution.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres issue assignee resolution tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("issueAssigneeResolutionService", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof issueAssigneeResolutionService>;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("issue-assignee-resolution-service");
    stopDb = started.stop;
    db = createDb(started.connectionString);
    svc = issueAssigneeResolutionService(db);
  });

  afterEach(async () => {
    await db.delete(positionAssignments);
    await db.delete(positions);
    await db.delete(agents);
    await db.delete(companyMemberships);
    await db.delete(companies);
  });

  afterAll(async () => {
    await stopDb?.();
  });

  async function seedCompany(name = "Acme") {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name,
      status: "active",
      issuePrefix: name.slice(0, 3).toUpperCase(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return companyId;
  }

  async function seedAgent(companyId: string, status = "active") {
    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Engineer",
      role: "engineer",
      status,
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return agentId;
  }

  async function seedPosition(companyId: string, status = "active") {
    const [position] = await db
      .insert(positions)
      .values({
        companyId,
        name: "Delivery owner",
        status,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return position.id;
  }

  async function seedUserMembership(companyId: string, userId = "user-1") {
    await db.insert(companyMemberships).values({
      companyId,
      principalType: "user",
      principalId: userId,
      status: "active",
      membershipRole: "operator",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return userId;
  }

  async function seedAssignment(
    companyId: string,
    positionId: string,
    principalType: "agent" | "user",
    principalId: string,
  ) {
    await db.insert(positionAssignments).values({
      companyId,
      positionId,
      principalType,
      principalId,
      status: "active",
      startedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  it("resolves a position occupied by an agent to the issue agent assignee field", async () => {
    const companyId = await seedCompany("AgentCo");
    const agentId = await seedAgent(companyId);
    const positionId = await seedPosition(companyId);
    await seedAssignment(companyId, positionId, "agent", agentId);

    const resolved = await svc.resolvePositionSelection(companyId, { assigneePositionId: positionId });

    expect(resolved).toEqual({
      assigneeAgentId: agentId,
      assigneeUserId: null,
      resolvedPositionId: positionId,
    });
  });

  it("resolves a position occupied by a user to the issue user assignee field", async () => {
    const companyId = await seedCompany("UserCo");
    const userId = await seedUserMembership(companyId, "user-42");
    const positionId = await seedPosition(companyId);
    await seedAssignment(companyId, positionId, "user", userId);

    const resolved = await svc.resolvePositionSelection(companyId, { assigneePositionId: positionId });

    expect(resolved).toEqual({
      assigneeAgentId: null,
      assigneeUserId: userId,
      resolvedPositionId: positionId,
    });
  });

  it("rejects empty, ambiguous, and archived position selections", async () => {
    const companyId = await seedCompany("RejectCo");
    const agentId = await seedAgent(companyId);
    const userId = await seedUserMembership(companyId, "user-ambiguous");
    const emptyPositionId = await seedPosition(companyId);
    const ambiguousPositionId = await seedPosition(companyId);
    const archivedPositionId = await seedPosition(companyId, "archived");
    await seedAssignment(companyId, ambiguousPositionId, "agent", agentId);
    await seedAssignment(companyId, ambiguousPositionId, "user", userId);

    await expect(svc.resolvePositionSelection(companyId, { assigneePositionId: emptyPositionId }))
      .rejects.toMatchObject({ status: 422 });
    await expect(svc.resolvePositionSelection(companyId, { assigneePositionId: ambiguousPositionId }))
      .rejects.toMatchObject({ status: 422 });
    await expect(svc.resolvePositionSelection(companyId, { assigneePositionId: archivedPositionId }))
      .rejects.toMatchObject({ status: 422 });
  });

  it("rejects selections that mix position with explicit issue assignees", async () => {
    const companyId = await seedCompany("MixedCo");
    const positionId = await seedPosition(companyId);
    const agentId = await seedAgent(companyId);

    await expect(svc.resolvePositionSelection(companyId, {
      assigneePositionId: positionId,
      assigneeAgentId: agentId,
    })).rejects.toMatchObject({ status: 422 });
  });

  it("rejects occupants that no longer belong to the same company", async () => {
    const companyId = await seedCompany("HomeCo");
    const otherCompanyId = await seedCompany("OtherCo");
    const otherAgentId = await seedAgent(otherCompanyId);
    const positionId = await seedPosition(companyId);
    await seedAssignment(companyId, positionId, "agent", otherAgentId);

    await expect(svc.resolvePositionSelection(companyId, { assigneePositionId: positionId }))
      .rejects.toMatchObject({ status: 422 });
  });
});
