import { z } from "zod";
import {
  WORKFLOW_DECISIONS,
  WORKFLOW_PARTICIPANT_PRINCIPAL_TYPES,
  WORKFLOW_PARTICIPANT_ROLES,
  WORKFLOW_STAGE_TYPES,
  WORKFLOW_TRIGGER_KINDS,
} from "../constants.js";

const workflowParticipantSchema = z.object({
  principalType: z.enum(WORKFLOW_PARTICIPANT_PRINCIPAL_TYPES),
  principalId: z.string().trim().min(1).max(200),
  role: z.enum(WORKFLOW_PARTICIPANT_ROLES).optional(),
});

export type WorkflowParticipantInput = z.infer<typeof workflowParticipantSchema>;

export const startIssueWorkflowSchema = z.object({
  templateId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(200).optional(),
  triggerKind: z.enum(WORKFLOW_TRIGGER_KINDS).optional().default("manual"),
  stages: z.array(z.object({
    key: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/),
    type: z.enum(WORKFLOW_STAGE_TYPES),
    requiredDecisions: z.number().int().min(1).max(20).optional().default(1),
    dueAt: z.string().datetime().optional().nullable(),
    participants: z.array(workflowParticipantSchema).min(1).max(50),
  })).min(1).max(20),
});

export type StartIssueWorkflow = z.infer<typeof startIssueWorkflowSchema>;

export const workflowDecisionSchema = z.object({
  decision: z.enum(WORKFLOW_DECISIONS),
  note: z.string().trim().max(10_000).optional().nullable(),
});

export type WorkflowDecisionInput = z.infer<typeof workflowDecisionSchema>;
