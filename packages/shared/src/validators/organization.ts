import { z } from "zod";
import {
  ORGANIZATION_STATUSES,
  POSITION_ASSIGNMENT_PRINCIPAL_TYPES,
  POSITION_ASSIGNMENT_STATUSES,
} from "../constants.js";

const nullableTextSchema = z.string().trim().max(10_000).optional().nullable();

export const createDepartmentSchema = z.object({
  parentDepartmentId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(200),
  description: nullableTextSchema,
  status: z.enum(ORGANIZATION_STATUSES).optional().default("active"),
});

export type CreateDepartment = z.infer<typeof createDepartmentSchema>;

export const updateDepartmentSchema = createDepartmentSchema.partial();

export type UpdateDepartment = z.infer<typeof updateDepartmentSchema>;

export const createPositionSchema = z.object({
  departmentId: z.string().uuid().optional().nullable(),
  reportsToPositionId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(200),
  description: nullableTextSchema,
  responsibilities: nullableTextSchema,
  status: z.enum(ORGANIZATION_STATUSES).optional().default("active"),
});

export type CreatePosition = z.infer<typeof createPositionSchema>;

export const updatePositionSchema = createPositionSchema.partial();

export type UpdatePosition = z.infer<typeof updatePositionSchema>;

export const createPositionAssignmentSchema = z.object({
  positionId: z.string().uuid(),
  principalType: z.enum(POSITION_ASSIGNMENT_PRINCIPAL_TYPES),
  principalId: z.string().trim().min(1).max(200),
  status: z.enum(POSITION_ASSIGNMENT_STATUSES).optional().default("active"),
});

export type CreatePositionAssignment = z.infer<typeof createPositionAssignmentSchema>;

export const updatePositionAssignmentSchema = z.object({
  status: z.enum(POSITION_ASSIGNMENT_STATUSES).optional(),
  endedAt: z.string().datetime().optional().nullable(),
});

export type UpdatePositionAssignment = z.infer<typeof updatePositionAssignmentSchema>;
