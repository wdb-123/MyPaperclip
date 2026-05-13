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

  async function wouldCreateDepartmentCycle(input: {
    companyId: string;
    departmentId: string;
    parentDepartmentId: string | null | undefined;
  }) {
    let cursor = input.parentDepartmentId ?? null;
    const visited = new Set<string>();

    while (cursor) {
      if (cursor === input.departmentId) return true;
      if (visited.has(cursor)) return true;
      visited.add(cursor);

      const [row] = await db
        .select({ parentDepartmentId: departments.parentDepartmentId })
        .from(departments)
        .where(and(eq(departments.id, cursor), eq(departments.companyId, input.companyId)))
        .limit(1);
      if (!row) return true;
      cursor = row.parentDepartmentId ?? null;
    }

    return false;
  }

  async function wouldCreatePositionCycle(input: {
    companyId: string;
    positionId: string;
    reportsToPositionId: string | null | undefined;
  }) {
    let cursor = input.reportsToPositionId ?? null;
    const visited = new Set<string>();

    while (cursor) {
      if (cursor === input.positionId) return true;
      if (visited.has(cursor)) return true;
      visited.add(cursor);

      const [row] = await db
        .select({ reportsToPositionId: positions.reportsToPositionId })
        .from(positions)
        .where(and(eq(positions.id, cursor), eq(positions.companyId, input.companyId)))
        .limit(1);
      if (!row) return true;
      cursor = row.reportsToPositionId ?? null;
    }

    return false;
  }

  async function getPositionForAssignment(companyId: string, positionId: string) {
    const [row] = await db
      .select({ id: positions.id, status: positions.status })
      .from(positions)
      .where(and(eq(positions.id, positionId), eq(positions.companyId, companyId)))
      .limit(1);
    return row ?? null;
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
      if (input.parentDepartmentId && await wouldCreateDepartmentCycle({
        companyId: existing.companyId,
        departmentId: id,
        parentDepartmentId: input.parentDepartmentId,
      })) {
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
      if (input.reportsToPositionId && await wouldCreatePositionCycle({
        companyId: existing.companyId,
        positionId: id,
        reportsToPositionId: input.reportsToPositionId,
      })) {
        return null;
      }
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
      const position = await getPositionForAssignment(companyId, input.positionId);
      if (!position) return null;
      const nextStatus = input.status ?? "active";
      if (nextStatus === "active" && position.status === "archived") return null;
      if (!(await assertPrincipalInCompany(companyId, input.principalType, input.principalId))) return null;
      const values = {
        ...input,
        companyId,
        endedAt: nextStatus === "ended" && !input.endedAt ? new Date() : input.endedAt,
      };
      const [row] = await db.insert(positionAssignments).values(values).returning();
      return row ?? null;
    },

    async updatePositionAssignment(id: string, input: UpdatePositionAssignmentInput) {
      const existing = await this.getPositionAssignment(id);
      if (!existing) return null;
      const nextStatus = input.status ?? existing.status;
      const values = {
        ...input,
        endedAt: nextStatus === "ended" && !input.endedAt && !existing.endedAt ? new Date() : input.endedAt,
      };
      const [row] = await db
        .update(positionAssignments)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(positionAssignments.id, id))
        .returning();
      return row ?? null;
    },
  };
}
