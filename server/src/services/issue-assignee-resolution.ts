import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  companyMemberships,
  positionAssignments,
  positions,
} from "@paperclipai/db";
import { unprocessable } from "../errors.js";

export type IssueAssigneeSelectionInput = {
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  assigneePositionId?: string | null;
};

export type ResolvedIssueAssigneeSelection = {
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  resolvedPositionId?: string;
};

function hasPrincipal(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

export function issueAssigneeResolutionService(db: Db) {
  return {
    async resolvePositionSelection(
      companyId: string,
      input: IssueAssigneeSelectionInput,
    ): Promise<ResolvedIssueAssigneeSelection> {
      const assigneePositionId = input.assigneePositionId?.trim() || null;
      if (!assigneePositionId) {
        return {
          assigneeAgentId: input.assigneeAgentId,
          assigneeUserId: input.assigneeUserId,
        };
      }

      if (hasPrincipal(input.assigneeAgentId) || hasPrincipal(input.assigneeUserId)) {
        throw unprocessable("assigneePositionId cannot be combined with assigneeAgentId or assigneeUserId");
      }

      const [position] = await db
        .select({ id: positions.id, status: positions.status })
        .from(positions)
        .where(and(eq(positions.id, assigneePositionId), eq(positions.companyId, companyId)))
        .limit(1);

      if (!position) {
        throw unprocessable("Assignee position was not found in this company");
      }
      if (position.status !== "active") {
        throw unprocessable("Assignee position must be active");
      }

      const activeAssignments = await db
        .select({
          id: positionAssignments.id,
          principalType: positionAssignments.principalType,
          principalId: positionAssignments.principalId,
        })
        .from(positionAssignments)
        .where(
          and(
            eq(positionAssignments.companyId, companyId),
            eq(positionAssignments.positionId, assigneePositionId),
            eq(positionAssignments.status, "active"),
          ),
        )
        .orderBy(asc(positionAssignments.createdAt));

      if (activeAssignments.length === 0) {
        throw unprocessable("Assignee position has no active occupant");
      }
      if (activeAssignments.length > 1) {
        throw unprocessable("Assignee position has multiple active occupants");
      }

      const [assignment] = activeAssignments;
      if (assignment.principalType === "agent") {
        const [agent] = await db
          .select({ id: agents.id, status: agents.status })
          .from(agents)
          .where(and(eq(agents.id, assignment.principalId), eq(agents.companyId, companyId)))
          .limit(1);
        if (!agent || agent.status === "terminated" || agent.status === "pending_approval") {
          throw unprocessable("Assignee position occupant is not an assignable agent in this company");
        }
        return {
          assigneeAgentId: agent.id,
          assigneeUserId: null,
          resolvedPositionId: assigneePositionId,
        };
      }

      if (assignment.principalType === "user") {
        const [membership] = await db
          .select({ id: companyMemberships.id })
          .from(companyMemberships)
          .where(
            and(
              eq(companyMemberships.companyId, companyId),
              eq(companyMemberships.principalType, "user"),
              eq(companyMemberships.principalId, assignment.principalId),
              eq(companyMemberships.status, "active"),
            ),
          )
          .limit(1);
        if (!membership) {
          throw unprocessable("Assignee position occupant is not an active user in this company");
        }
        return {
          assigneeAgentId: null,
          assigneeUserId: assignment.principalId,
          resolvedPositionId: assigneePositionId,
        };
      }

      throw unprocessable("Assignee position occupant type is not assignable");
    },
  };
}
