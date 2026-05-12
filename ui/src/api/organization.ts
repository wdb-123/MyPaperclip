import { api } from "./client";

export type Department = {
  id: string;
  companyId: string;
  parentDepartmentId: string | null;
  name: string;
  description: string | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
};

export type Position = {
  id: string;
  companyId: string;
  departmentId: string | null;
  reportsToPositionId: string | null;
  name: string;
  description: string | null;
  responsibilities: string | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
};

export type PositionAssignment = {
  id: string;
  companyId: string;
  positionId: string;
  principalType: "user" | "agent";
  principalId: string;
  status: "active" | "ended";
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreateDepartmentInput = {
  parentDepartmentId?: string | null;
  name: string;
  description?: string | null;
  status?: "active" | "archived";
};

export type CreatePositionInput = {
  departmentId?: string | null;
  reportsToPositionId?: string | null;
  name: string;
  description?: string | null;
  responsibilities?: string | null;
  status?: "active" | "archived";
};

export type CreatePositionAssignmentInput = {
  positionId: string;
  principalType: "user" | "agent";
  principalId: string;
  status?: "active" | "ended";
};

export const organizationApi = {
  listDepartments: (companyId: string) =>
    api.get<Department[]>(`/companies/${companyId}/departments`),
  createDepartment: (companyId: string, input: CreateDepartmentInput) =>
    api.post<Department>(`/companies/${companyId}/departments`, input),
  updateDepartment: (id: string, input: Partial<CreateDepartmentInput>) =>
    api.patch<Department>(`/departments/${id}`, input),

  listPositions: (companyId: string) =>
    api.get<Position[]>(`/companies/${companyId}/positions`),
  createPosition: (companyId: string, input: CreatePositionInput) =>
    api.post<Position>(`/companies/${companyId}/positions`, input),
  updatePosition: (id: string, input: Partial<CreatePositionInput>) =>
    api.patch<Position>(`/positions/${id}`, input),

  listPositionAssignments: (companyId: string) =>
    api.get<PositionAssignment[]>(`/companies/${companyId}/position-assignments`),
  createPositionAssignment: (companyId: string, input: CreatePositionAssignmentInput) =>
    api.post<PositionAssignment>(`/companies/${companyId}/position-assignments`, input),
  updatePositionAssignment: (id: string, input: { status?: "active" | "ended"; endedAt?: string | null }) =>
    api.patch<PositionAssignment>(`/position-assignments/${id}`, input),
};
