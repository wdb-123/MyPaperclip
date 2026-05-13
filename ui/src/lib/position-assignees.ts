import type { Position, PositionAssignment } from "../api/organization";
import { assigneeValueFromSelection } from "./assignees";

type AssignableAgent = {
  id: string;
  name: string;
  role?: string | null;
  title?: string | null;
  status?: string | null;
};

export type PositionAssigneeOption = {
  id: string;
  label: string;
  searchText: string;
  position: Position;
  principalType: PositionAssignment["principalType"];
  principalId: string;
  resolvedAssigneeValue: string;
  resolvedLabel: string;
  agent?: AssignableAgent;
};

export function buildPositionAssigneeOptions(input: {
  positions?: Position[] | null;
  assignments?: PositionAssignment[] | null;
  agents?: AssignableAgent[] | null;
  userLabel: (userId: string) => string | null;
}): PositionAssigneeOption[] {
  // TODO(position-assignment): Keep this UI helper as presentation only.
  // Issue create/update routes need a server-side position resolver so API
  // clients, agents, and plugins get the same single-assignee behavior.
  const agentById = new Map(
    (input.agents ?? [])
      .filter((agent) => agent.status !== "terminated")
      .map((agent) => [agent.id, agent]),
  );
  const activeAssignmentsByPosition = new Map<string, PositionAssignment[]>();

  for (const assignment of input.assignments ?? []) {
    if (assignment.status !== "active") continue;
    const existing = activeAssignmentsByPosition.get(assignment.positionId) ?? [];
    existing.push(assignment);
    activeAssignmentsByPosition.set(assignment.positionId, existing);
  }

  return (input.positions ?? [])
    .filter((position) => position.status === "active")
    .flatMap((position) => {
      const assignments = activeAssignmentsByPosition.get(position.id) ?? [];
      const options: PositionAssigneeOption[] = [];

      for (const assignment of assignments) {
        if (assignment.principalType === "agent") {
          const agent = agentById.get(assignment.principalId);
          if (!agent) continue;
          const resolvedAssigneeValue = assigneeValueFromSelection({ assigneeAgentId: agent.id });
          options.push({
            id: `position:${position.id}:agent:${agent.id}`,
            label: `岗位: ${position.name} -> ${agent.name}`,
            searchText: `${position.name} ${position.description ?? ""} ${position.responsibilities ?? ""} ${agent.name} ${agent.role ?? ""} ${agent.title ?? ""} 岗位 职位`,
            position,
            principalType: "agent",
            principalId: agent.id,
            resolvedAssigneeValue,
            resolvedLabel: agent.name,
            agent,
          });
          continue;
        }

        const label = input.userLabel(assignment.principalId);
        if (!label) continue;
        const resolvedAssigneeValue = assigneeValueFromSelection({ assigneeUserId: assignment.principalId });
        options.push({
          id: `position:${position.id}:user:${assignment.principalId}`,
          label: `岗位: ${position.name} -> ${label}`,
          searchText: `${position.name} ${position.description ?? ""} ${position.responsibilities ?? ""} ${label} ${assignment.principalId} 岗位 职位`,
          position,
          principalType: "user",
          principalId: assignment.principalId,
          resolvedAssigneeValue,
          resolvedLabel: label,
        });
      }

      return options;
    });
}
