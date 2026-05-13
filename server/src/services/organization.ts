import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  companyMemberships,
  departments,
  positionAssignments,
  positions,
} from "@paperclipai/db";

type CreateDepartmentInput = typeof departments.$inferInsert;
type UpdateDepartmentInput = Partial<Omit<CreateDepartmentInput, "id" | "companyId" | "createdAt">>;
type CreatePositionInput = typeof positions.$inferInsert;
type UpdatePositionInput = Partial<Omit<CreatePositionInput, "id" | "companyId" | "createdAt">>;
type CreatePositionAssignmentInput = typeof positionAssignments.$inferInsert;
type UpdatePositionAssignmentInput = Partial<Omit<CreatePositionAssignmentInput, "id" | "companyId" | "positionId" | "principalType" | "principalId" | "createdAt">>;

export function organizationService(db: Db) {
  // TODO(org-governance): Enforce acyclic department and position trees before
  // accepting parentDepartmentId or reportsToPositionId changes.
  async function assertDepartmentInCompany(companyId: string, departmentId: string | null | undefined) {
    if (!departmentId) return;
    const [row] = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.id, departmentId), eq(departments.companyId, companyId)))
      .limit(1);
    return Boolean(row);
  }

  async function assertPositionInCompany(companyId: string, positionId: string | null | undefined) {
    if (!positionId) return;
    const [row] = await db
      .select({ id: positions.id })
      .from(positions)
      .where(and(eq(positions.id, positionId), eq(positions.companyId, companyId)))
      .limit(1);
    return Boolean(row);
  }

  async function assertPrincipalInCompany(companyId: string, principalType: string, principalId: string) {
    if (principalType === "agent") {
      const [row] = await db
        .select({ id: agents.id })
        .from(agents)
        .where(and(eq(agents.id, principalId), eq(agents.companyId, companyId)))
        .limit(1);
      return Boolean(row);
    }
    if (principalType === "user") {
      const [row] = await db
        .select({ id: companyMemberships.id })
        .from(companyMemberships)
        .where(
          and(
            eq(companyMemberships.companyId, companyId),
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, principalId),
            eq(companyMemberships.status, "active"),
          ),
        )
        .limit(1);
      return Boolean(row);
    }
    return false;
  }

  return {
    async listDepartments(companyId: string) {
      return db
        .select()
        .from(departments)
        .where(eq(departments.companyId, companyId))
        .orderBy(asc(departments.name));
    },

    async getDepartment(id: string) {
      const [row] = await db.select().from(departments).where(eq(departments.id, id)).limit(1);
      return row ?? null;
    },

    async createDepartment(companyId: string, input: Omit<CreateDepartmentInput, "companyId">) {
      if (input.parentDepartmentId && !(await assertDepartmentInCompany(companyId, input.parentDepartmentId))) {
        return null;
      }
      const [row] = await db.insert(departments).values({ ...input, companyId }).returning();
      return row ?? null;
    },

    async updateDepartment(id: string, input: UpdateDepartmentInput) {
      const existing = await this.getDepartment(id);
      if (!existing) return null;
      if (input.parentDepartmentId === id) return null;
      if (input.parentDepartmentId && !(await assertDepartmentInCompany(existing.companyId, input.parentDepartmentId))) {
        return null;
      }
      const [row] = await db
        .update(departments)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(departments.id, id))
        .returning();
      return row ?? null;
    },

    async listPositions(companyId: string) {
      return db
        .select()
        .from(positions)
        .where(eq(positions.companyId, companyId))
        .orderBy(asc(positions.name));
    },

    async getPosition(id: string) {
      const [row] = await db.select().from(positions).where(eq(positions.id, id)).limit(1);
      return row ?? null;
    },

    async createPosition(companyId: string, input: Omit<CreatePositionInput, "companyId">) {
      if (input.departmentId && !(await assertDepartmentInCompany(companyId, input.departmentId))) return null;
      if (input.reportsToPositionId && !(await assertPositionInCompany(companyId, input.reportsToPositionId))) return null;
      const [row] = await db.insert(positions).values({ ...input, companyId }).returning();
      return row ?? null;
    },

    async updatePosition(id: string, input: UpdatePositionInput) {
      const existing = await this.getPosition(id);
      if (!existing) return null;
      if (input.reportsToPositionId === id) return null;
      if (input.departmentId && !(await assertDepartmentInCompany(existing.companyId, input.departmentId))) return null;
      if (input.reportsToPositionId && !(await assertPositionInCompany(existing.companyId, input.reportsToPositionId))) return null;
      const [row] = await db
        .update(positions)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(positions.id, id))
        .returning();
      return row ?? null;
    },

    async listPositionAssignments(companyId: string) {
      return db
        .select()
        .from(positionAssignments)
        .where(eq(positionAssignments.companyId, companyId))
        .orderBy(asc(positionAssignments.createdAt));
    },

    async getPositionAssignment(id: string) {
      const [row] = await db.select().from(positionAssignments).where(eq(positionAssignments.id, id)).limit(1);
      return row ?? null;
    },

    async createPositionAssignment(companyId: string, input: Omit<CreatePositionAssignmentInput, "companyId">) {
      // TODO(org-governance): Reject active assignments for archived positions
      // and auto-fill endedAt when status transitions to ended.
      if (!(await assertPositionInCompany(companyId, input.positionId))) return null;
      if (!(await assertPrincipalInCompany(companyId, input.principalType, input.principalId))) return null;
      const [row] = await db.insert(positionAssignments).values({ ...input, companyId }).returning();
      return row ?? null;
    },

    async updatePositionAssignment(id: string, input: UpdatePositionAssignmentInput) {
      const [row] = await db
        .update(positionAssignments)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(positionAssignments.id, id))
        .returning();
      return row ?? null;
    },
  };
}
