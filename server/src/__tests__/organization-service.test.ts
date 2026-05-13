import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  companyMemberships,
  createDb,
  departments,
  positionAssignments,
  positions,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { organizationService } from "../services/organization.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres organization service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("organizationService governance invariants", () => {
  let stopDb: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof organizationService>;

  beforeAll(async () => {
    const started = await startEmbeddedPostgresTestDatabase("organization-service");
    stopDb = started.stop;
    db = createDb(started.connectionString);
    svc = organizationService(db);
  });

  afterEach(async () => {
    await db.delete(positionAssignments);
    await db.delete(positions);
    await db.delete(departments);
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

  async function seedAgent(companyId: string) {
    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Engineer",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return agentId;
  }

  it("rejects department parent cycles", async () => {
    const companyId = await seedCompany("DeptCo");
    const root = await svc.createDepartment(companyId, { name: "Root" });
    const child = await svc.createDepartment(companyId, { name: "Child", parentDepartmentId: root!.id });

    const cycle = await svc.updateDepartment(root!.id, { parentDepartmentId: child!.id });

    expect(cycle).toBeNull();
    expect(await svc.getDepartment(root!.id)).toMatchObject({ parentDepartmentId: null });
  });

  it("rejects position reporting cycles", async () => {
    const companyId = await seedCompany("PosCo");
    const lead = await svc.createPosition(companyId, { name: "Lead" });
    const engineer = await svc.createPosition(companyId, { name: "Engineer", reportsToPositionId: lead!.id });

    const cycle = await svc.updatePosition(lead!.id, { reportsToPositionId: engineer!.id });

    expect(cycle).toBeNull();
    expect(await svc.getPosition(lead!.id)).toMatchObject({ reportsToPositionId: null });
  });

  it("rejects active assignments for archived positions", async () => {
    const companyId = await seedCompany("ArchiveCo");
    const agentId = await seedAgent(companyId);
    const position = await svc.createPosition(companyId, { name: "Archived seat", status: "archived" });

    const assignment = await svc.createPositionAssignment(companyId, {
      positionId: position!.id,
      principalType: "agent",
      principalId: agentId,
      status: "active",
    });

    expect(assignment).toBeNull();
  });

  it("auto-fills endedAt when an assignment is ended", async () => {
    const companyId = await seedCompany("EndedCo");
    const agentId = await seedAgent(companyId);
    const position = await svc.createPosition(companyId, { name: "Temporary seat" });
    const assignment = await svc.createPositionAssignment(companyId, {
      positionId: position!.id,
      principalType: "agent",
      principalId: agentId,
    });

    const ended = await svc.updatePositionAssignment(assignment!.id, { status: "ended" });

    expect(ended?.status).toBe("ended");
    expect(ended?.endedAt).toBeInstanceOf(Date);
  });

  it("rejects principals from another company", async () => {
    const companyId = await seedCompany("HomeCo");
    const otherCompanyId = await seedCompany("OtherCo");
    const otherAgentId = await seedAgent(otherCompanyId);
    const position = await svc.createPosition(companyId, { name: "Home seat" });

    const assignment = await svc.createPositionAssignment(companyId, {
      positionId: position!.id,
      principalType: "agent",
      principalId: otherAgentId,
    });

    expect(assignment).toBeNull();
  });
});
