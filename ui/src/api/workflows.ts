import {
  WORKFLOW_DECISIONS,
  WORKFLOW_PARTICIPANT_PRINCIPAL_TYPES,
  WORKFLOW_PARTICIPANT_ROLES,
  WORKFLOW_STAGE_TYPES,
} from "@paperclipai/shared";
import { api } from "./client";

type WorkflowDecision = (typeof WORKFLOW_DECISIONS)[number];
type WorkflowParticipantPrincipalType = (typeof WORKFLOW_PARTICIPANT_PRINCIPAL_TYPES)[number];
type WorkflowParticipantRole = (typeof WORKFLOW_PARTICIPANT_ROLES)[number];
type WorkflowStageType = (typeof WORKFLOW_STAGE_TYPES)[number];

export interface WorkflowParticipant {
  id: string;
  companyId: string;
  stageInstanceId: string;
  principalType: WorkflowParticipantPrincipalType;
  principalId: string;
  role: WorkflowParticipantRole;
  decision: WorkflowDecision | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStage {
  id: string;
  companyId: string;
  workflowInstanceId: string;
  stageKey: string;
  stageType: WorkflowStageType;
  stageOrder: number;
  approvalId: string | null;
  status: "pending" | "in_progress" | "approved" | "rejected" | string;
  requiredDecisions: number;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  participants: WorkflowParticipant[];
}

export interface IssueWorkflow {
  id: string;
  companyId: string;
  templateId: string | null;
  subjectType: "issue" | string;
  subjectId: string;
  status: "active" | "completed" | "failed" | string;
  currentStageKey: string | null;
  createdByUserId: string | null;
  createdByAgentId: string | null;
  createdAt: string;
  updatedAt: string;
  stages: WorkflowStage[];
}

export interface StartIssueWorkflowInput {
  templateId?: string | null;
  name?: string;
  triggerKind?: "manual" | "issue_created" | "status_changed";
  stages: Array<{
    key: string;
    type: WorkflowStageType;
    requiredDecisions?: number;
    dueAt?: string | null;
    participants: Array<{
      principalType: WorkflowParticipantPrincipalType;
      principalId: string;
      role?: WorkflowParticipantRole;
    }>;
  }>;
}

export interface WorkflowDecisionInput {
  decision: WorkflowDecision;
  note?: string | null;
}

export const workflowsApi = {
  listForIssue: (issueId: string, companyId: string) =>
    api.get<IssueWorkflow[]>(`/issues/${issueId}/workflows?companyId=${encodeURIComponent(companyId)}`),

  startForIssue: (issueId: string, companyId: string, input: StartIssueWorkflowInput) =>
    api.post<IssueWorkflow>(`/issues/${issueId}/workflows?companyId=${encodeURIComponent(companyId)}`, input),

  decideStage: (stageId: string, input: WorkflowDecisionInput) =>
    api.post<{
      row: { stage: WorkflowStage; instance: IssueWorkflow };
      advanced: null | {
        completed: boolean;
        nextStage: WorkflowStage | null;
        current: WorkflowStage;
      };
    }>(`/workflow-stages/${stageId}/decisions`, input),
};
