import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Link, useNavigate } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentsApi, type OrgNode } from "../api/agents";
import { organizationApi, type Department, type Position, type PositionAssignment } from "../api/organization";
import { accessApi } from "../api/access";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useLanguage } from "../context/LanguageContext";
import { useToast } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { agentUrl, cn } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { AgentIcon } from "../components/AgentIconPicker";
import { Download, Hexagon, Maximize2, Minus, Network, Pencil, Plus, Trash2, Upload, UsersRound } from "lucide-react";
import { AGENT_ROLE_LABELS, type Agent } from "@paperclipai/shared";

// Layout constants
const CARD_W = 200;
const CARD_H = 100;
const GAP_X = 32;
const GAP_Y = 80;
const PADDING = 60;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;
const TOUCH_MOVE_THRESHOLD = 6;

// ── Tree layout types ───────────────────────────────────────────────────

interface LayoutNode {
  id: string;
  name: string;
  role: string;
  status: string;
  kind: "agent" | "position";
  departmentName?: string | null;
  assignments?: Array<{
    id: string;
    label: string;
    principalType: "agent" | "user";
    agentId?: string;
  }>;
  x: number;
  y: number;
  children: LayoutNode[];
}

interface ChartNode {
  id: string;
  name: string;
  role: string;
  status: string;
  kind: "agent" | "position";
  departmentName?: string | null;
  assignments?: LayoutNode["assignments"];
  reports: ChartNode[];
}

interface Point {
  x: number;
  y: number;
}

interface TouchGesture {
  mode: "pan" | "pinch" | null;
  startPoint: Point;
  startPan: Point;
  startZoom: number;
  startDistance: number;
  startCenter: Point;
  moved: boolean;
}

// ── Layout algorithm ────────────────────────────────────────────────────

/** Compute the width each subtree needs. */
function subtreeWidth(node: ChartNode): number {
  if (node.reports.length === 0) return CARD_W;
  const childrenW = node.reports.reduce((sum, c) => sum + subtreeWidth(c), 0);
  const gaps = (node.reports.length - 1) * GAP_X;
  return Math.max(CARD_W, childrenW + gaps);
}

/** Recursively assign x,y positions. */
function layoutTree(node: ChartNode, x: number, y: number): LayoutNode {
  const totalW = subtreeWidth(node);
  const layoutChildren: LayoutNode[] = [];

  if (node.reports.length > 0) {
    const childrenW = node.reports.reduce((sum, c) => sum + subtreeWidth(c), 0);
    const gaps = (node.reports.length - 1) * GAP_X;
    let cx = x + (totalW - childrenW - gaps) / 2;

    for (const child of node.reports) {
      const cw = subtreeWidth(child);
      layoutChildren.push(layoutTree(child, cx, y + CARD_H + GAP_Y));
      cx += cw + GAP_X;
    }
  }

  return {
    id: node.id,
    name: node.name,
    role: node.role,
    status: node.status,
    kind: node.kind,
    departmentName: node.departmentName,
    assignments: node.assignments,
    x: x + (totalW - CARD_W) / 2,
    y,
    children: layoutChildren,
  };
}

/** Layout all root nodes side by side. */
function layoutForest(roots: ChartNode[]): LayoutNode[] {
  if (roots.length === 0) return [];

  const totalW = roots.reduce((sum, r) => sum + subtreeWidth(r), 0);
  const gaps = (roots.length - 1) * GAP_X;
  let x = PADDING;
  const y = PADDING;

  const result: LayoutNode[] = [];
  for (const root of roots) {
    const w = subtreeWidth(root);
    result.push(layoutTree(root, x, y));
    x += w + GAP_X;
  }

  // Compute bounds and return
  return result;
}

function agentNodesToChart(nodes: OrgNode[]): ChartNode[] {
  return nodes.map((node) => ({
    id: node.id,
    name: node.name,
    role: node.role,
    status: node.status,
    kind: "agent",
    reports: agentNodesToChart(node.reports),
  }));
}

function buildPositionChart(input: {
  positions: Position[];
  departments: Department[];
  assignments: PositionAssignment[];
  agentMap: Map<string, Agent>;
  userMap: Map<string, string>;
}): ChartNode[] {
  const departmentMap = new Map(input.departments.map((department) => [department.id, department]));
  const positionMap = new Map(input.positions.map((position) => [position.id, position]));
  const childrenByParent = new Map<string, Position[]>();
  const roots: Position[] = [];

  for (const position of input.positions) {
    const parentId = position.reportsToPositionId;
    if (parentId && positionMap.has(parentId)) {
      const children = childrenByParent.get(parentId) ?? [];
      children.push(position);
      childrenByParent.set(parentId, children);
    } else {
      roots.push(position);
    }
  }

  const assignmentMap = new Map<string, PositionAssignment[]>();
  for (const assignment of input.assignments) {
    if (assignment.status !== "active") continue;
    const existing = assignmentMap.get(assignment.positionId) ?? [];
    existing.push(assignment);
    assignmentMap.set(assignment.positionId, existing);
  }

  const toNode = (position: Position): ChartNode => {
    const department = position.departmentId ? departmentMap.get(position.departmentId) : null;
    const assignments = (assignmentMap.get(position.id) ?? []).map((assignment) => {
      if (assignment.principalType === "agent") {
        const agent = input.agentMap.get(assignment.principalId);
        return {
          id: assignment.id,
          label: agent?.name ?? assignment.principalId,
          principalType: "agent" as const,
          agentId: assignment.principalId,
        };
      }

      return {
        id: assignment.id,
        label: input.userMap.get(assignment.principalId) ?? assignment.principalId,
        principalType: "user" as const,
      };
    });

    return {
      id: position.id,
      name: position.name,
      role: department?.name ?? "Position",
      status: position.status,
      kind: "position",
      departmentName: department?.name ?? null,
      assignments,
      reports: (childrenByParent.get(position.id) ?? []).map(toNode),
    };
  };

  return roots.map(toNode);
}

/** Flatten layout tree to list of nodes. */
function flattenLayout(nodes: LayoutNode[]): LayoutNode[] {
  const result: LayoutNode[] = [];
  function walk(n: LayoutNode) {
    result.push(n);
    n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}

/** Collect all parent→child edges. */
function collectEdges(nodes: LayoutNode[]): Array<{ parent: LayoutNode; child: LayoutNode }> {
  const edges: Array<{ parent: LayoutNode; child: LayoutNode }> = [];
  function walk(n: LayoutNode) {
    for (const c of n.children) {
      edges.push({ parent: n, child: c });
      walk(c);
    }
  }
  nodes.forEach(walk);
  return edges;
}

function clampZoom(value: number): number {
  return Math.min(Math.max(value, MIN_ZOOM), MAX_ZOOM);
}

function touchPoint(touch: React.Touch): Point {
  return { x: touch.clientX, y: touch.clientY };
}

function touchDistance(a: React.Touch, b: React.Touch): number {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.hypot(dx, dy);
}

function touchCenter(a: React.Touch, b: React.Touch, container: HTMLDivElement): Point {
  const rect = container.getBoundingClientRect();
  return {
    x: (a.clientX + b.clientX) / 2 - rect.left,
    y: (a.clientY + b.clientY) / 2 - rect.top,
  };
}

// ── Status dot colors (raw hex for SVG) ─────────────────────────────────

import { getAdapterLabel } from "../adapters/adapter-display-registry";

const statusDotColor: Record<string, string> = {
  running: "#22d3ee",
  active: "#4ade80",
  paused: "#facc15",
  idle: "#facc15",
  error: "#f87171",
  terminated: "#a3a3a3",
};
const defaultDotColor = "#a3a3a3";

// ── Main component ──────────────────────────────────────────────────────

export function OrgChart() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { t } = useLanguage();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [departmentName, setDepartmentName] = useState("");
  const [departmentParentId, setDepartmentParentId] = useState("");
  const [showTopLevelDepartmentForm, setShowTopLevelDepartmentForm] = useState(false);
  const [childDepartmentParentId, setChildDepartmentParentId] = useState<string | null>(null);
  const [childDepartmentName, setChildDepartmentName] = useState("");
  const [positionDraftDepartmentId, setPositionDraftDepartmentId] = useState<string | null>(null);
  const [positionDraftName, setPositionDraftName] = useState("");
  const [positionDraftReportsToId, setPositionDraftReportsToId] = useState("");
  const [assignmentDraftPositionId, setAssignmentDraftPositionId] = useState<string | null>(null);
  const [assignmentDraftPrincipalType, setAssignmentDraftPrincipalType] = useState<"user" | "agent">("user");
  const [assignmentDraftPrincipalId, setAssignmentDraftPrincipalId] = useState("");
  const [editingDepartmentId, setEditingDepartmentId] = useState<string | null>(null);
  const [editingDepartmentName, setEditingDepartmentName] = useState("");
  const [editingPositionId, setEditingPositionId] = useState<string | null>(null);
  const [editingPositionName, setEditingPositionName] = useState("");
  const departmentNameInputRef = useRef<HTMLInputElement>(null);

  const { data: orgTree, isLoading } = useQuery({
    queryKey: queryKeys.org(selectedCompanyId!),
    queryFn: () => agentsApi.org(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: departments } = useQuery({
    queryKey: queryKeys.organization.departments(selectedCompanyId!),
    queryFn: () => organizationApi.listDepartments(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: positions } = useQuery({
    queryKey: queryKeys.organization.positions(selectedCompanyId!),
    queryFn: () => organizationApi.listPositions(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: positionAssignments } = useQuery({
    queryKey: queryKeys.organization.positionAssignments(selectedCompanyId!),
    queryFn: () => organizationApi.listPositionAssignments(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: userDirectory } = useQuery({
    queryKey: queryKeys.access.companyUserDirectory(selectedCompanyId!),
    queryFn: () => accessApi.listUserDirectory(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const agentMap = useMemo(() => {
    const m = new Map<string, Agent>();
    for (const a of agents ?? []) m.set(a.id, a);
    return m;
  }, [agents]);

  const userMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const entry of userDirectory?.users ?? []) {
      m.set(entry.principalId, entry.user?.name || entry.user?.email || entry.principalId);
    }
    return m;
  }, [userDirectory]);

  const activeUsers = useMemo(
    () => (userDirectory?.users ?? []).filter((entry) => entry.status === "active"),
    [userDirectory],
  );

  const activeAgents = useMemo(
    () => (agents ?? []).filter((agent) => agent.status !== "terminated" && agent.status !== "pending_approval"),
    [agents],
  );

  const activePositions = useMemo(
    () => (positions ?? []).filter((position) => position.status === "active"),
    [positions],
  );

  const positionMap = useMemo(() => {
    const m = new Map<string, Position>();
    for (const position of activePositions) m.set(position.id, position);
    return m;
  }, [activePositions]);

  const activeDepartments = useMemo(
    () => (departments ?? []).filter((department) => department.status === "active"),
    [departments],
  );

  const departmentMap = useMemo(() => {
    const m = new Map<string, Department>();
    for (const department of activeDepartments) m.set(department.id, department);
    return m;
  }, [activeDepartments]);

  const departmentRows = useMemo(() => {
    const childCount = new Map<string, number>();
    for (const department of activeDepartments) {
      if (!department.parentDepartmentId) continue;
      childCount.set(department.parentDepartmentId, (childCount.get(department.parentDepartmentId) ?? 0) + 1);
    }

    const getDepth = (department: Department) => {
      let depth = 0;
      let cursor = department.parentDepartmentId;
      const visited = new Set<string>();
      while (cursor && !visited.has(cursor)) {
        visited.add(cursor);
        const parent = departmentMap.get(cursor);
        if (!parent) break;
        depth += 1;
        cursor = parent.parentDepartmentId;
      }
      return depth;
    };

    return activeDepartments
      .map((department) => ({
        department,
        childCount: childCount.get(department.id) ?? 0,
        depth: getDepth(department),
        parentName: department.parentDepartmentId
          ? departmentMap.get(department.parentDepartmentId)?.name ?? t("未知上级", "Unknown parent")
          : t("公司直属", "Company-level"),
        positions: activePositions.filter((position) => position.departmentId === department.id),
      }))
      .sort((a, b) => a.depth - b.depth || a.department.name.localeCompare(b.department.name));
  }, [activeDepartments, activePositions, departmentMap, t]);

  const startChildDepartment = useCallback((parentDepartmentId: string) => {
    setChildDepartmentParentId(parentDepartmentId);
    setChildDepartmentName("");
  }, []);

  const startAssignmentDraft = useCallback((positionId: string) => {
    setAssignmentDraftPositionId(positionId);
    setAssignmentDraftPrincipalType("user");
    setAssignmentDraftPrincipalId("");
  }, []);

  const startDepartmentEdit = useCallback((department: Department) => {
    setEditingDepartmentId(department.id);
    setEditingDepartmentName(department.name);
  }, []);

  const startPositionEdit = useCallback((position: Position) => {
    setEditingPositionId(position.id);
    setEditingPositionName(position.name);
  }, []);

  const getDepartmentLineageIds = useCallback((departmentId: string) => {
    const ids: string[] = [];
    let cursor: string | null = departmentId;
    const visited = new Set<string>();

    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      ids.push(cursor);
      cursor = departmentMap.get(cursor)?.parentDepartmentId ?? null;
    }

    return ids;
  }, [departmentMap]);

  const getReportTargetPositions = useCallback((departmentId: string) => {
    const lineageIds = new Set(getDepartmentLineageIds(departmentId));
    return activePositions.filter((position) => position.departmentId && lineageIds.has(position.departmentId));
  }, [activePositions, getDepartmentLineageIds]);

  const getDefaultReportsToPositionId = useCallback((departmentId: string) => {
    const lineageIds = getDepartmentLineageIds(departmentId);
    for (const ancestorDepartmentId of lineageIds.slice(1)) {
      const lead = activePositions.find(
        (position) => position.departmentId === ancestorDepartmentId && !position.reportsToPositionId,
      );
      if (lead) return lead.id;

      const fallback = activePositions.find((position) => position.departmentId === ancestorDepartmentId);
      if (fallback) return fallback.id;
    }
    return "";
  }, [activePositions, getDepartmentLineageIds]);

  const startPositionDraft = useCallback((departmentId: string) => {
    setPositionDraftDepartmentId(departmentId);
    setPositionDraftName("");
    setPositionDraftReportsToId(getDefaultReportsToPositionId(departmentId));
  }, [getDefaultReportsToPositionId]);

  const formatPositionWithDepartment = useCallback((position: Position) => {
    const departmentName = position.departmentId
      ? departmentMap.get(position.departmentId)?.name
      : null;
    return departmentName ? `${position.name} · ${departmentName}` : position.name;
  }, [departmentMap]);

  const invalidateOrganization = useCallback(async () => {
    if (!selectedCompanyId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.organization.departments(selectedCompanyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.organization.positions(selectedCompanyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.organization.positionAssignments(selectedCompanyId) }),
    ]);
  }, [queryClient, selectedCompanyId]);

  const createDepartmentMutation = useMutation({
    mutationFn: (input: { name: string; parentDepartmentId: string | null }) =>
      organizationApi.createDepartment(selectedCompanyId!, {
        name: input.name,
        parentDepartmentId: input.parentDepartmentId,
      }),
    onSuccess: async () => {
      setDepartmentName("");
      setDepartmentParentId("");
      setShowTopLevelDepartmentForm(false);
      setChildDepartmentName("");
      setChildDepartmentParentId(null);
      await invalidateOrganization();
      pushToast({ title: t("部门已创建", "Department created"), tone: "success" });
    },
    onError: (error) => {
      pushToast({
        title: t("创建部门失败", "Failed to create department"),
        body: error instanceof Error ? error.message : t("未知错误", "Unknown error"),
        tone: "error",
      });
    },
  });

  const createPositionMutation = useMutation({
    mutationFn: (input: { name: string; departmentId: string; reportsToPositionId: string | null }) =>
      organizationApi.createPosition(selectedCompanyId!, {
        name: input.name,
        departmentId: input.departmentId,
        reportsToPositionId: input.reportsToPositionId,
      }),
    onSuccess: async () => {
      setPositionDraftName("");
      setPositionDraftDepartmentId(null);
      setPositionDraftReportsToId("");
      await invalidateOrganization();
      pushToast({ title: t("岗位已创建", "Position created"), tone: "success" });
    },
    onError: (error) => {
      pushToast({
        title: t("创建岗位失败", "Failed to create position"),
        body: error instanceof Error ? error.message : t("未知错误", "Unknown error"),
        tone: "error",
      });
    },
  });

  const createAssignmentMutation = useMutation({
    mutationFn: (input: { positionId: string; principalType: "user" | "agent"; principalId: string }) =>
      organizationApi.createPositionAssignment(selectedCompanyId!, {
        positionId: input.positionId,
        principalType: input.principalType,
        principalId: input.principalId,
      }),
    onSuccess: async () => {
      setAssignmentDraftPositionId(null);
      setAssignmentDraftPrincipalId("");
      await invalidateOrganization();
      pushToast({ title: t("任职已创建", "Assignment created"), tone: "success" });
    },
    onError: (error) => {
      pushToast({
        title: t("创建任职失败", "Failed to create assignment"),
        body: error instanceof Error ? error.message : t("未知错误", "Unknown error"),
        tone: "error",
      });
    },
  });

  const updateDepartmentMutation = useMutation({
    mutationFn: (input: { id: string; name?: string; status?: "active" | "archived" }) =>
      organizationApi.updateDepartment(input.id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.status ? { status: input.status } : {}),
      }),
    onSuccess: async () => {
      setEditingDepartmentId(null);
      setEditingDepartmentName("");
      await invalidateOrganization();
      pushToast({ title: t("部门已更新", "Department updated"), tone: "success" });
    },
    onError: (error) => {
      pushToast({
        title: t("更新部门失败", "Failed to update department"),
        body: error instanceof Error ? error.message : t("未知错误", "Unknown error"),
        tone: "error",
      });
    },
  });

  const updatePositionMutation = useMutation({
    mutationFn: (input: { id: string; name?: string; status?: "active" | "archived" }) =>
      organizationApi.updatePosition(input.id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.status ? { status: input.status } : {}),
      }),
    onSuccess: async () => {
      setEditingPositionId(null);
      setEditingPositionName("");
      await invalidateOrganization();
      pushToast({ title: t("岗位已更新", "Position updated"), tone: "success" });
    },
    onError: (error) => {
      pushToast({
        title: t("更新岗位失败", "Failed to update position"),
        body: error instanceof Error ? error.message : t("未知错误", "Unknown error"),
        tone: "error",
      });
    },
  });

  const endAssignmentMutation = useMutation({
    mutationFn: (assignmentId: string) =>
      organizationApi.updatePositionAssignment(assignmentId, { status: "ended" }),
    onSuccess: async () => {
      await invalidateOrganization();
      pushToast({ title: t("任职已结束", "Assignment ended"), tone: "success" });
    },
    onError: (error) => {
      pushToast({
        title: t("结束任职失败", "Failed to end assignment"),
        body: error instanceof Error ? error.message : t("未知错误", "Unknown error"),
        tone: "error",
      });
    },
  });

  useEffect(() => {
    setBreadcrumbs([{ label: t("组织图", "Org Chart") }]);
  }, [setBreadcrumbs, t]);

  useEffect(() => {
    if (departmentParentId && !departmentMap.has(departmentParentId)) {
      setDepartmentParentId("");
    }
    if (childDepartmentParentId && !departmentMap.has(childDepartmentParentId)) {
      setChildDepartmentParentId(null);
      setChildDepartmentName("");
    }
  }, [childDepartmentParentId, departmentMap, departmentParentId]);

  useEffect(() => {
    if (positionDraftDepartmentId && !departmentMap.has(positionDraftDepartmentId)) {
      setPositionDraftDepartmentId(null);
      setPositionDraftName("");
      setPositionDraftReportsToId("");
    }
  }, [departmentMap, positionDraftDepartmentId]);

  useEffect(() => {
    if (!positionDraftReportsToId) return;
    if (!positionDraftDepartmentId) {
      setPositionDraftReportsToId("");
      return;
    }
    const availableTargets = getReportTargetPositions(positionDraftDepartmentId);
    if (!availableTargets.some((position) => position.id === positionDraftReportsToId)) {
      setPositionDraftReportsToId("");
    }
  }, [getReportTargetPositions, positionDraftDepartmentId, positionDraftReportsToId]);

  useEffect(() => {
    if (assignmentDraftPositionId && !positionMap.has(assignmentDraftPositionId)) {
      setAssignmentDraftPositionId(null);
      setAssignmentDraftPrincipalId("");
    }
  }, [assignmentDraftPositionId, positionMap]);

  const chartRoots = useMemo(() => {
    if (activePositions.length > 0) {
      return buildPositionChart({
        positions: activePositions,
        departments: activeDepartments,
        assignments: positionAssignments ?? [],
        agentMap,
        userMap,
      });
    }
    return agentNodesToChart(orgTree ?? []);
  }, [activeDepartments, activePositions, agentMap, orgTree, positionAssignments, userMap]);

  const chartMode = activePositions.length > 0 ? "positions" : "agents";

  // Layout computation
  const layout = useMemo(() => layoutForest(chartRoots), [chartRoots]);
  const allNodes = useMemo(() => flattenLayout(layout), [layout]);
  const edges = useMemo(() => collectEdges(layout), [layout]);

  // Compute SVG bounds
  const bounds = useMemo(() => {
    if (allNodes.length === 0) return { width: 800, height: 600 };
    let maxX = 0, maxY = 0;
    for (const n of allNodes) {
      maxX = Math.max(maxX, n.x + CARD_W);
      maxY = Math.max(maxY, n.y + CARD_H);
    }
    return { width: maxX + PADDING, height: maxY + PADDING };
  }, [allNodes]);

  // Pan & zoom state
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const touchGesture = useRef<TouchGesture>({
    mode: null,
    startPoint: { x: 0, y: 0 },
    startPan: { x: 0, y: 0 },
    startZoom: 1,
    startDistance: 0,
    startCenter: { x: 0, y: 0 },
    moved: false,
  });
  const suppressNextCardClick = useRef(false);
  const suppressClickTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (suppressClickTimerRef.current !== null) {
        window.clearTimeout(suppressClickTimerRef.current);
      }
    };
  }, []);

  // Center the chart on first load
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (hasInitialized.current || allNodes.length === 0 || !containerRef.current) return;
    hasInitialized.current = true;

    const container = containerRef.current;
    const containerW = container.clientWidth;
    const containerH = container.clientHeight;

    // Fit chart to container
    const scaleX = (containerW - 40) / bounds.width;
    const scaleY = (containerH - 40) / bounds.height;
    const fitZoom = Math.min(scaleX, scaleY, 1);

    const chartW = bounds.width * fitZoom;
    const chartH = bounds.height * fitZoom;

    setZoom(fitZoom);
    setPan({
      x: (containerW - chartW) / 2,
      y: (containerH - chartH) / 2,
    });
  }, [allNodes, bounds]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    // Don't drag if clicking a card
    const target = e.target as HTMLElement;
    if (target.closest("[data-org-card]")) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy });
  }, [dragging]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = clampZoom(zoom * factor);

    // Zoom toward mouse position
    const scale = newZoom / zoom;
    setPan({
      x: mouseX - scale * (mouseX - pan.x),
      y: mouseY - scale * (mouseY - pan.y),
    });
    setZoom(newZoom);
  }, [zoom, pan]);

  const zoomTowardPoint = useCallback((newZoom: number, point: Point) => {
    const clampedZoom = clampZoom(newZoom);
    const scale = clampedZoom / zoom;
    setPan({
      x: point.x - scale * (point.x - pan.x),
      y: point.y - scale * (point.y - pan.y),
    });
    setZoom(clampedZoom);
  }, [zoom, pan]);

  const fitToScreen = useCallback(() => {
    if (!containerRef.current) return;
    const cW = containerRef.current.clientWidth;
    const cH = containerRef.current.clientHeight;
    const scaleX = (cW - 40) / bounds.width;
    const scaleY = (cH - 40) / bounds.height;
    const fitZoom = Math.min(scaleX, scaleY, 1);
    const chartW = bounds.width * fitZoom;
    const chartH = bounds.height * fitZoom;
    setZoom(fitZoom);
    setPan({ x: (cW - chartW) / 2, y: (cH - chartH) / 2 });
  }, [bounds]);

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length >= 2 && containerRef.current) {
      const [first, second] = [e.touches[0]!, e.touches[1]!];
      touchGesture.current = {
        mode: "pinch",
        startPoint: { x: 0, y: 0 },
        startPan: pan,
        startZoom: zoom,
        startDistance: touchDistance(first, second),
        startCenter: touchCenter(first, second, containerRef.current),
        moved: false,
      };
      return;
    }

    const touch = e.touches[0];
    if (!touch) return;
    touchGesture.current = {
      mode: "pan",
      startPoint: touchPoint(touch),
      startPan: pan,
      startZoom: zoom,
      startDistance: 0,
      startCenter: { x: 0, y: 0 },
      moved: false,
    };
  }, [pan, zoom]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container || !touchGesture.current.mode) return;

    if (e.touches.length >= 2) {
      const [first, second] = [e.touches[0]!, e.touches[1]!];
      const distance = touchDistance(first, second);
      const center = touchCenter(first, second, container);

      if (touchGesture.current.mode !== "pinch" || touchGesture.current.startDistance === 0) {
        touchGesture.current = {
          mode: "pinch",
          startPoint: { x: 0, y: 0 },
          startPan: pan,
          startZoom: zoom,
          startDistance: distance,
          startCenter: center,
          moved: false,
        };
        return;
      }

      const gesture = touchGesture.current;
      const nextZoom = clampZoom(gesture.startZoom * (distance / gesture.startDistance));
      const scale = nextZoom / gesture.startZoom;
      const dx = center.x - gesture.startCenter.x;
      const dy = center.y - gesture.startCenter.y;
      gesture.moved =
        gesture.moved ||
        Math.abs(distance - gesture.startDistance) > TOUCH_MOVE_THRESHOLD ||
        Math.hypot(dx, dy) > TOUCH_MOVE_THRESHOLD;
      setZoom(nextZoom);
      setPan({
        x: center.x - scale * (gesture.startCenter.x - gesture.startPan.x),
        y: center.y - scale * (gesture.startCenter.y - gesture.startPan.y),
      });
      return;
    }

    const touch = e.touches[0];
    if (!touch || touchGesture.current.mode !== "pan") return;
    const dx = touch.clientX - touchGesture.current.startPoint.x;
    const dy = touch.clientY - touchGesture.current.startPoint.y;
    touchGesture.current.moved = touchGesture.current.moved || Math.hypot(dx, dy) > TOUCH_MOVE_THRESHOLD;
    setPan({
      x: touchGesture.current.startPan.x + dx,
      y: touchGesture.current.startPan.y + dy,
    });
  }, [pan, zoom]);

  const handleTouchEnd = useCallback(() => {
    if (touchGesture.current.moved) {
      suppressNextCardClick.current = true;
      if (suppressClickTimerRef.current !== null) {
        window.clearTimeout(suppressClickTimerRef.current);
      }
      suppressClickTimerRef.current = window.setTimeout(() => {
        suppressNextCardClick.current = false;
        suppressClickTimerRef.current = null;
      }, 400);
    }
    touchGesture.current = {
      mode: null,
      startPoint: { x: 0, y: 0 },
      startPan: pan,
      startZoom: zoom,
      startDistance: 0,
      startCenter: { x: 0, y: 0 },
      moved: false,
    };
  }, [pan, zoom]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Network} message={t("请选择公司以查看组织图。", "Select a company to view the org chart.")} />;
  }

  if (isLoading) {
    return <PageSkeleton variant="org-chart" />;
  }

  return (
    <div className="flex h-[calc(100dvh-9rem)] min-h-[420px] flex-col md:h-full md:min-h-0">
      <div className="mb-2 flex shrink-0 flex-wrap items-center justify-start gap-2">
        <div className="mr-auto flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5">
            <UsersRound className="h-3.5 w-3.5" />
            <span>{t("部门", "Departments")}: {departments?.length ?? 0}</span>
          </div>
          <div className="rounded-md border border-border bg-card px-2.5 py-1.5">
            {t("岗位", "Positions")}: {positions?.length ?? 0}
          </div>
          <div className="rounded-md border border-border bg-card px-2.5 py-1.5">
            {t("任职", "Assignments")}: {positionAssignments?.length ?? 0}
          </div>
          <div className="rounded-md border border-border bg-card px-2.5 py-1.5">
            {chartMode === "positions" ? t("岗位组织图", "Position chart") : t("代理组织图", "Agent chart")}
          </div>
        </div>
        <Link to="/company/import">
          <Button variant="outline" size="sm">
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {t("导入公司", "Import company")}
          </Button>
        </Link>
        <Link to="/company/export">
          <Button variant="outline" size="sm">
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {t("导出公司", "Export company")}
          </Button>
        </Link>
      </div>
      <div className="mb-3 shrink-0 rounded-md border border-border bg-card p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-medium">{t("部门结构", "Department Structure")}</div>
            <div className="text-xs text-muted-foreground">
              {t("部门是主容器；在部门卡片里添加下级部门和本部门岗位。", "Departments are the main container; add child departments and positions inside each department card.")}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setDepartmentParentId("");
              setDepartmentName("");
              setShowTopLevelDepartmentForm(true);
              setChildDepartmentParentId(null);
              setChildDepartmentName("");
            }}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t("添加一级部门", "Add top-level")}
          </Button>
        </div>
        {showTopLevelDepartmentForm ? (
          <form
            className="mb-3 grid gap-2 rounded-md border border-border bg-muted/30 p-3 md:max-w-xl"
            onSubmit={(event) => {
              event.preventDefault();
              if (!departmentName.trim() || createDepartmentMutation.isPending) return;
              createDepartmentMutation.mutate({
                name: departmentName.trim(),
                parentDepartmentId: departmentParentId || null,
              });
            }}
          >
            <label className="grid gap-1 text-xs font-medium text-muted-foreground">
              <span>{t("一级部门名称", "Top-level department name")}</span>
              <input
                ref={departmentNameInputRef}
                className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-ring"
                value={departmentName}
                onChange={(event) => setDepartmentName(event.target.value)}
                placeholder={t("例如：产品部", "Example: Product")}
                autoFocus
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowTopLevelDepartmentForm(false);
                  setDepartmentName("");
                  setDepartmentParentId("");
                }}
              >
                {t("取消", "Cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={!departmentName.trim() || createDepartmentMutation.isPending}
              >
                {createDepartmentMutation.isPending ? t("正在创建...", "Creating...") : t("创建一级部门", "Create top-level")}
              </Button>
            </div>
          </form>
        ) : null}
        {departmentRows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
            {t("还没有部门。先创建一个一级部门，再从部门行添加下级部门。", "No departments yet. Create a top-level department first, then add child departments from department rows.")}
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {departmentRows.map(({ department, childCount, depth, parentName, positions: departmentPositions }) => {
              const reportTargetPositions = getReportTargetPositions(department.id);
              return (
              <div key={department.id} className="rounded-md border border-border bg-background px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0" style={{ paddingLeft: `${Math.min(depth, 4) * 12}px` }}>
                    {editingDepartmentId === department.id ? (
                      <form
                        className="flex min-w-0 gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (!editingDepartmentName.trim() || updateDepartmentMutation.isPending) return;
                          updateDepartmentMutation.mutate({
                            id: department.id,
                            name: editingDepartmentName.trim(),
                          });
                        }}
                      >
                        <input
                          className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-ring"
                          value={editingDepartmentName}
                          onChange={(event) => setEditingDepartmentName(event.target.value)}
                          autoFocus
                        />
                        <Button type="submit" size="xs" disabled={!editingDepartmentName.trim() || updateDepartmentMutation.isPending}>
                          {t("保存", "Save")}
                        </Button>
                      </form>
                    ) : (
                      <div className="truncate text-sm font-medium">{department.name}</div>
                    )}
                    <div className="truncate text-xs text-muted-foreground">
                      {t("上级", "Parent")}: {parentName}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {t("下级", "Children")} {childCount}
                    </span>
                    <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {t("岗位", "Positions")} {departmentPositions.length}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      title={t("编辑部门", "Edit department")}
                      onClick={() => startDepartmentEdit(department)}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      title={t("删除部门", "Delete department")}
                      disabled={childCount > 0 || departmentPositions.length > 0 || updateDepartmentMutation.isPending}
                      onClick={() => {
                        if (!window.confirm(t("归档这个部门？需要先删除下级部门和岗位。", "Archive this department? Child departments and positions must be removed first."))) return;
                        updateDepartmentMutation.mutate({ id: department.id, status: "archived" });
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div className="mt-2 grid gap-1 rounded-md bg-muted/20 p-2">
                  <div className="text-xs font-medium text-muted-foreground">{t("本部门岗位", "Department positions")}</div>
                  {departmentPositions.length === 0 ? (
                    <div className="text-xs text-muted-foreground">{t("暂无岗位，点击“添加岗位”创建。", "No positions yet. Click Add position to create one.")}</div>
                  ) : (
                    <div className="grid gap-2">
                      {departmentPositions.map((position) => {
                        const assignments = (positionAssignments ?? []).filter(
                          (assignment) => assignment.positionId === position.id && assignment.status === "active",
                        );
                        const reportsTo = position.reportsToPositionId ? positionMap.get(position.reportsToPositionId) : null;
                        return (
                          <div key={position.id} className="grid gap-2 rounded border border-border bg-background px-2 py-2 text-xs">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                {editingPositionId === position.id ? (
                                  <form
                                    className="mb-1 flex min-w-0 gap-2"
                                    onSubmit={(event) => {
                                      event.preventDefault();
                                      if (!editingPositionName.trim() || updatePositionMutation.isPending) return;
                                      updatePositionMutation.mutate({
                                        id: position.id,
                                        name: editingPositionName.trim(),
                                      });
                                    }}
                                  >
                                    <input
                                      className="h-7 min-w-0 rounded-md border border-input bg-background px-2 text-xs outline-none focus:border-ring"
                                      value={editingPositionName}
                                      onChange={(event) => setEditingPositionName(event.target.value)}
                                      autoFocus
                                    />
                                    <Button type="submit" size="xs" disabled={!editingPositionName.trim() || updatePositionMutation.isPending}>
                                      {t("保存", "Save")}
                                    </Button>
                                  </form>
                                ) : (
                                  <div className="font-medium">{position.name}</div>
                                )}
                                <div className="text-muted-foreground">
                                  {reportsTo
                                    ? `${t("汇报给", "Reports to")}: ${formatPositionWithDepartment(reportsTo)}`
                                    : t("顶层岗位", "Top role")}
                                </div>
                              </div>
                              <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                {assignments.length > 0 ? t("已任职", "Filled") : t("空缺", "Open")}
                              </span>
                            </div>
                            <div className="flex justify-end gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                onClick={() => startPositionEdit(position)}
                              >
                                <Pencil className="h-3 w-3" />
                                {t("编辑", "Edit")}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                disabled={assignments.length > 0 || updatePositionMutation.isPending}
                                onClick={() => {
                                  if (!window.confirm(t("归档这个岗位？需要先结束任职。", "Archive this position? Active assignments must be ended first."))) return;
                                  updatePositionMutation.mutate({ id: position.id, status: "archived" });
                                }}
                              >
                                <Trash2 className="h-3 w-3" />
                                {t("删除", "Delete")}
                              </Button>
                            </div>
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="text-muted-foreground">{t("任职者", "Occupant")}:</span>
                              {assignments.length === 0 ? (
                                <span className="text-muted-foreground">{t("未分配", "Unassigned")}</span>
                              ) : assignments.map((assignment) => (
                                <span key={assignment.id} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
                                  {assignment.principalType === "agent"
                                    ? agentMap.get(assignment.principalId)?.name ?? assignment.principalId
                                    : userMap.get(assignment.principalId) ?? assignment.principalId}
                                  <button
                                    type="button"
                                    className="text-muted-foreground hover:text-destructive"
                                    title={t("结束任职", "End assignment")}
                                    onClick={() => {
                                      if (!window.confirm(t("结束这个任职？", "End this assignment?"))) return;
                                      endAssignmentMutation.mutate(assignment.id);
                                    }}
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                            </div>
                            <div className="flex justify-end">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => startAssignmentDraft(position.id)}
                              >
                                {assignments.length === 0 ? t("分配账号", "Assign account") : t("追加任职", "Add occupant")}
                              </Button>
                            </div>
                            {assignmentDraftPositionId === position.id ? (
                              <form
                                className="grid gap-2 rounded-md border border-border bg-muted/30 p-2"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  if (!assignmentDraftPrincipalId || !assignmentDraftPositionId || createAssignmentMutation.isPending) return;
                                  createAssignmentMutation.mutate({
                                    positionId: assignmentDraftPositionId,
                                    principalType: assignmentDraftPrincipalType,
                                    principalId: assignmentDraftPrincipalId,
                                  });
                                }}
                              >
                                <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                                  <span>{t("任职对象类型", "Occupant type")}</span>
                                  <select
                                    className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-ring"
                                    value={assignmentDraftPrincipalType}
                                    onChange={(event) => {
                                      setAssignmentDraftPrincipalType(event.target.value as "user" | "agent");
                                      setAssignmentDraftPrincipalId("");
                                    }}
                                  >
                                    <option value="user">{t("用户账号", "User account")}</option>
                                    <option value="agent">{t("Agent", "Agent")}</option>
                                  </select>
                                </label>
                                <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                                  <span>{t("选择任职者", "Select occupant")}</span>
                                  <select
                                    className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-ring"
                                    value={assignmentDraftPrincipalId}
                                    onChange={(event) => setAssignmentDraftPrincipalId(event.target.value)}
                                  >
                                    <option value="">
                                      {assignmentDraftPrincipalType === "user"
                                        ? t("选择用户账号", "Select user account")
                                        : t("选择 Agent", "Select agent")}
                                    </option>
                                    {assignmentDraftPrincipalType === "user"
                                      ? activeUsers.map((entry) => (
                                        <option key={entry.principalId} value={entry.principalId}>
                                          {entry.user?.name || entry.user?.email || entry.principalId}
                                        </option>
                                      ))
                                      : activeAgents.map((agent) => (
                                        <option key={agent.id} value={agent.id}>{agent.name}</option>
                                      ))}
                                  </select>
                                </label>
                                <div className="flex justify-end gap-2">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setAssignmentDraftPositionId(null);
                                      setAssignmentDraftPrincipalId("");
                                    }}
                                  >
                                    {t("取消", "Cancel")}
                                  </Button>
                                  <Button
                                    type="submit"
                                    size="sm"
                                    disabled={!assignmentDraftPrincipalId || createAssignmentMutation.isPending}
                                  >
                                    {createAssignmentMutation.isPending ? t("正在分配...", "Assigning...") : t("确认分配", "Assign")}
                                  </Button>
                                </div>
                              </form>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => startChildDepartment(department.id)}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    {t("添加下级", "Add child")}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => startPositionDraft(department.id)}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    {t("添加岗位", "Add position")}
                  </Button>
                </div>
                {childDepartmentParentId === department.id ? (
                  <form
                    className="mt-3 grid gap-2 rounded-md border border-border bg-muted/30 p-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!childDepartmentName.trim() || !childDepartmentParentId || createDepartmentMutation.isPending) return;
                      createDepartmentMutation.mutate({
                        name: childDepartmentName.trim(),
                        parentDepartmentId: childDepartmentParentId,
                      });
                    }}
                  >
                    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                      <span>{t("下级部门名称", "Child department name")}</span>
                      <input
                        className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-ring"
                        value={childDepartmentName}
                        onChange={(event) => setChildDepartmentName(event.target.value)}
                        placeholder={t("输入下级部门名称", "Enter child department name")}
                        autoFocus
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                      <span>{t("挂到哪个上级部门", "Parent department")}</span>
                      <select
                        className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-ring"
                        value={childDepartmentParentId}
                        onChange={(event) => setChildDepartmentParentId(event.target.value)}
                      >
                        {activeDepartments.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
                        ))}
                      </select>
                    </label>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setChildDepartmentParentId(null);
                          setChildDepartmentName("");
                        }}
                      >
                        {t("取消", "Cancel")}
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={!childDepartmentName.trim() || createDepartmentMutation.isPending}
                      >
                        {createDepartmentMutation.isPending ? t("正在创建...", "Creating...") : t("创建下级", "Create child")}
                      </Button>
                    </div>
                  </form>
                ) : null}
                {positionDraftDepartmentId === department.id ? (
                  <form
                    className="mt-3 grid gap-2 rounded-md border border-border bg-muted/30 p-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!positionDraftName.trim() || !positionDraftDepartmentId || createPositionMutation.isPending) return;
                      createPositionMutation.mutate({
                        name: positionDraftName.trim(),
                        departmentId: positionDraftDepartmentId,
                        reportsToPositionId: positionDraftReportsToId || null,
                      });
                    }}
                  >
                    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                      <span>{t("岗位名称", "Position name")}</span>
                      <input
                        className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-ring"
                        value={positionDraftName}
                        onChange={(event) => setPositionDraftName(event.target.value)}
                        placeholder={t("例如：产品负责人", "Example: Product Lead")}
                        autoFocus
                      />
                    </label>
                    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
                      <span>{t("汇报给", "Reports to")}</span>
                      <select
                        className="h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus:border-ring"
                        value={positionDraftReportsToId}
                        onChange={(event) => setPositionDraftReportsToId(event.target.value)}
                      >
                        <option value="">{t("顶层岗位（不汇报给其他岗位）", "Top role / no reporting line")}</option>
                        {reportTargetPositions.map((position) => (
                          <option key={position.id} value={position.id}>{formatPositionWithDepartment(position)}</option>
                        ))}
                      </select>
                      <span className="text-xs font-normal text-muted-foreground">
                        {reportTargetPositions.length === 0
                          ? t("当前部门和上级部门还没有可选岗位。", "No positions are available in this department or its parent departments yet.")
                          : t("可选择本部门或上级部门链路中的岗位。", "You can choose a position from this department or its parent department chain.")}
                      </span>
                    </label>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setPositionDraftDepartmentId(null);
                          setPositionDraftName("");
                          setPositionDraftReportsToId("");
                        }}
                      >
                        {t("取消", "Cancel")}
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        disabled={!positionDraftName.trim() || createPositionMutation.isPending}
                      >
                        {createPositionMutation.isPending ? t("正在创建...", "Creating...") : t("创建岗位", "Create position")}
                      </Button>
                    </div>
                  </form>
                ) : null}
              </div>
              );
            })}
          </div>
        )}
      </div>
      <div
        ref={containerRef}
        data-testid="org-chart-viewport"
        className="w-full flex-1 min-h-0 overflow-hidden relative bg-muted/20 border border-border rounded-lg"
        style={{
          cursor: dragging ? "grabbing" : "grab",
          touchAction: "none",
          overscrollBehavior: "contain",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        {/* Zoom controls */}
        <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5">
          <button
            className="flex size-9 items-center justify-center rounded border border-border bg-background text-sm transition-colors hover:bg-accent sm:size-7"
            onClick={() => {
              const container = containerRef.current;
              if (container) {
                zoomTowardPoint(zoom * 1.2, {
                  x: container.clientWidth / 2,
                  y: container.clientHeight / 2,
                });
              }
            }}
            title={t("放大", "Zoom in")}
            aria-label={t("放大", "Zoom in")}
          >
            <Plus className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
          </button>
          <button
            className="flex size-9 items-center justify-center rounded border border-border bg-background text-sm transition-colors hover:bg-accent sm:size-7"
            onClick={() => {
              const container = containerRef.current;
              if (container) {
                zoomTowardPoint(zoom * 0.8, {
                  x: container.clientWidth / 2,
                  y: container.clientHeight / 2,
                });
              }
            }}
            title={t("缩小", "Zoom out")}
            aria-label={t("缩小", "Zoom out")}
          >
            <Minus className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
          </button>
          <button
            className="flex size-9 items-center justify-center rounded border border-border bg-background text-[10px] transition-colors hover:bg-accent sm:size-7"
            onClick={fitToScreen}
            title={t("适应屏幕", "Fit to screen")}
            aria-label={t("让组织图适应屏幕", "Fit chart to screen")}
          >
            <Maximize2 className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
          </button>
        </div>

        {/* SVG layer for edges */}
        <svg
          className="absolute inset-0 pointer-events-none"
          style={{
            width: "100%",
            height: "100%",
          }}
        >
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {edges.map(({ parent, child }) => {
              const x1 = parent.x + CARD_W / 2;
              const y1 = parent.y + CARD_H;
              const x2 = child.x + CARD_W / 2;
              const y2 = child.y;
              const midY = (y1 + y2) / 2;

              return (
                <path
                  key={`${parent.id}-${child.id}`}
                  d={`M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`}
                  fill="none"
                  stroke="var(--border)"
                  strokeWidth={1.5}
                />
              );
            })}
          </g>
        </svg>

        {/* Card layer */}
        <div
          data-testid="org-chart-card-layer"
          className="absolute inset-0"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {allNodes.map((node) => {
            const agent = node.kind === "agent" ? agentMap.get(node.id) : undefined;
            const dotColor = statusDotColor[node.status] ?? defaultDotColor;

            return (
              <div
                key={node.id}
                data-org-card
                className={cn(
                  "absolute bg-card border border-border rounded-lg shadow-sm transition-[box-shadow,border-color] duration-150 select-none",
                  node.kind === "agent" && "cursor-pointer hover:shadow-md hover:border-foreground/20",
                )}
                style={{
                  left: node.x,
                  top: node.y,
                  width: CARD_W,
                  minHeight: CARD_H,
                }}
                onClick={() => {
                  if (agent) navigate(agentUrl(agent));
                }}
                onClickCapture={(e) => {
                  if (!suppressNextCardClick.current) return;
                  suppressNextCardClick.current = false;
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <div className="flex items-center px-4 py-3 gap-3">
                  {/* Agent icon + status dot */}
                  <div className="relative shrink-0">
                    <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
                      {node.kind === "agent" ? (
                        <AgentIcon icon={agent?.icon} className="h-4.5 w-4.5 text-foreground/70" />
                      ) : (
                        <Hexagon className="h-4.5 w-4.5 text-foreground/70" />
                      )}
                    </div>
                    <span
                      className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card"
                      style={{ backgroundColor: dotColor }}
                    />
                  </div>
                  {/* Name + role + adapter type */}
                  <div className="flex flex-col items-start min-w-0 flex-1">
                    <span className="text-sm font-semibold text-foreground leading-tight">
                      {node.name}
                    </span>
                    <span className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                      {node.kind === "position" ? node.departmentName ?? t("未归属部门", "No department") : agent?.title ?? roleLabel(node.role)}
                    </span>
                    {agent && (
                      <span className="text-[10px] text-muted-foreground/60 font-mono leading-tight mt-1">
                        {getAdapterLabel(agent.adapterType)}
                      </span>
                    )}
                    {agent && agent.capabilities && (
                      <span className="text-[10px] text-muted-foreground/80 leading-tight mt-1 line-clamp-2">
                        {agent.capabilities}
                      </span>
                    )}
                    {node.kind === "position" && (
                      <div className="mt-1 flex w-full flex-wrap gap-1">
                        {node.assignments && node.assignments.length > 0 ? (
                          node.assignments.slice(0, 3).map((assignment) => (
                            <span
                              key={assignment.id}
                              className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground"
                            >
                              {assignment.principalType === "agent" ? (
                                <AgentIcon
                                  icon={assignment.agentId ? agentMap.get(assignment.agentId)?.icon : undefined}
                                  className="h-2.5 w-2.5 shrink-0"
                                />
                              ) : (
                                <UsersRound className="h-2.5 w-2.5 shrink-0" />
                              )}
                              <span className="truncate">{assignment.label}</span>
                            </span>
                          ))
                        ) : (
                          <span className="text-[10px] text-muted-foreground/70">
                            {t("暂无任职", "No assignments")}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {allNodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-muted-foreground pointer-events-none">
            {t("先创建部门、岗位或代理，即可生成组织图。", "Create departments, positions, or agents to generate the org chart.")}
          </div>
        )}
      </div>
    </div>
  );
}

const roleLabels: Record<string, string> = AGENT_ROLE_LABELS;

function roleLabel(role: string): string {
  return roleLabels[role] ?? role;
}
