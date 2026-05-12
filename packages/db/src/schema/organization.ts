import {
  type AnyPgColumn,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies.js";

export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    parentDepartmentId: uuid("parent_department_id").references((): AnyPgColumn => departments.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    description: text("description"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyParentIdx: index("departments_company_parent_idx").on(table.companyId, table.parentDepartmentId),
    companyStatusIdx: index("departments_company_status_idx").on(table.companyId, table.status),
  }),
);

export const positions = pgTable(
  "positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    reportsToPositionId: uuid("reports_to_position_id").references((): AnyPgColumn => positions.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    description: text("description"),
    responsibilities: text("responsibilities"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyDepartmentIdx: index("positions_company_department_idx").on(table.companyId, table.departmentId),
    companyReportsToIdx: index("positions_company_reports_to_idx").on(table.companyId, table.reportsToPositionId),
    companyStatusIdx: index("positions_company_status_idx").on(table.companyId, table.status),
  }),
);

export const positionAssignments = pgTable(
  "position_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    positionId: uuid("position_id").notNull().references(() => positions.id, { onDelete: "cascade" }),
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    status: text("status").notNull().default("active"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    activeUniqueIdx: uniqueIndex("position_assignments_active_unique_idx")
      .on(table.companyId, table.positionId, table.principalType, table.principalId)
      .where(sql`${table.status} = 'active'`),
    principalStatusIdx: index("position_assignments_principal_status_idx").on(
      table.companyId,
      table.principalType,
      table.principalId,
      table.status,
    ),
    positionRoleIdx: index("position_assignments_position_status_idx").on(table.companyId, table.positionId, table.status),
  }),
);
