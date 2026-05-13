import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

export const workflowTemplates = pgTable(
  "workflow_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    name: text("name").notNull(),
    description: text("description"),
    triggerKind: text("trigger_kind").notNull().default("manual"),
    definition: jsonb("definition").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("workflow_templates_company_status_idx").on(table.companyId, table.status),
  }),
);

export const workflowInstances = pgTable(
  "workflow_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    templateId: uuid("template_id").references(() => workflowTemplates.id, { onDelete: "set null" }),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    status: text("status").notNull().default("active"),
    currentStageKey: text("current_stage_key"),
    createdByUserId: text("created_by_user_id"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    subjectIdx: index("workflow_instances_subject_idx").on(table.companyId, table.subjectType, table.subjectId),
    statusIdx: index("workflow_instances_company_status_idx").on(table.companyId, table.status, table.updatedAt),
  }),
);

export const workflowStageInstances = pgTable(
  "workflow_stage_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    workflowInstanceId: uuid("workflow_instance_id").notNull().references(() => workflowInstances.id, { onDelete: "cascade" }),
    stageKey: text("stage_key").notNull(),
    stageType: text("stage_type").notNull(),
    status: text("status").notNull().default("pending"),
    requiredDecisions: integer("required_decisions").notNull().default(1),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workflowIdx: index("workflow_stage_instances_workflow_idx").on(table.companyId, table.workflowInstanceId),
    statusIdx: index("workflow_stage_instances_status_idx").on(table.companyId, table.status),
  }),
);

export const workflowParticipants = pgTable(
  "workflow_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    stageInstanceId: uuid("stage_instance_id").notNull().references(() => workflowStageInstances.id, { onDelete: "cascade" }),
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    role: text("role").notNull(),
    decision: text("decision"),
    decisionNote: text("decision_note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    principalRoleIdx: index("workflow_participants_principal_role_idx").on(
      table.companyId,
      table.principalType,
      table.principalId,
      table.role,
    ),
    stageRoleIdx: index("workflow_participants_stage_role_idx").on(table.companyId, table.stageInstanceId, table.role),
  }),
);
