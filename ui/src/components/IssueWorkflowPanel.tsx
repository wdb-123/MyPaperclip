import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, GitBranch, RotateCcw, XCircle } from "lucide-react";
import type { Agent } from "@paperclipai/shared";
import type { CompanyUserDirectoryEntry } from "../api/access";
import { ApiError } from "../api/client";
import { organizationApi, type Position } from "../api/organization";
import { workflowsApi, type IssueWorkflow, type WorkflowParticipant, type WorkflowStage } from "../api/workflows";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { cn, relativeTime } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STAGE_TYPE_LABELS: Record<string, string> = {
  assignment: "Assignment",
  review: "Review",
  approval: "Approval",
  notification: "Notify",
};

const STAGE_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_progress: "In progress",
  approved: "Approved",
  rejected: "Rejected",
};

const DECISION_LABELS: Record<string, string> = {
  approved: "Approved",
  rejected: "Rejected",
  revision_requested: "Revision requested",
};

type WorkflowStarterStage = {
  id: string;
  type: "review" | "approval";
  participantValue: string;
  requiredDecisions: number;
};

type WorkflowParticipantOption = {
  value: string;
  label: string;
  kind: "user" | "agent" | "position";
};

function formatPrincipal(
  participant: WorkflowParticipant,
  userLabelMap?: ReadonlyMap<string, string>,
  agentNameMap?: ReadonlyMap<string, string>,
  positionNameMap?: ReadonlyMap<string, string>,
) {
  if (participant.principalType === "user") return userLabelMap?.get(participant.principalId) ?? "User";
  if (participant.principalType === "agent") return agentNameMap?.get(participant.principalId) ?? "Agent";
  return positionNameMap?.get(participant.principalId) ?? "Position";
}

function WorkflowStatusPill({ status }: { status: string }) {
  return (
    <span className={cn(
      "inline-flex h-5 shrink-0 items-center rounded border px-1.5 text-[11px] font-medium",
      status === "active" && "border-blue-200 bg-blue-50 text-blue-700",
      status === "completed" && "border-emerald-200 bg-emerald-50 text-emerald-700",
      status === "failed" && "border-red-200 bg-red-50 text-red-700",
      !["active", "completed", "failed"].includes(status) && "border-border bg-muted text-muted-foreground",
    )}>
      {status}
    </span>
  );
}

function findCurrentStage(workflow: IssueWorkflow) {
  return workflow.stages.find((stage) => stage.status === "in_progress")
    ?? workflow.stages.find((stage) => stage.stageKey === workflow.currentStageKey)
    ?? null;
}

interface IssueWorkflowPanelProps {
  issueId: string;
  companyId: string;
  currentUserId: string | null;
  users?: CompanyUserDirectoryEntry[];
  agents?: Agent[];
  userLabelMap?: ReadonlyMap<string, string>;
  agentNameMap?: ReadonlyMap<string, string>;
  compact?: boolean;
}

export function IssueWorkflowPanel({
  issueId,
  companyId,
  currentUserId,
  users = [],
  agents = [],
  userLabelMap,
  agentNameMap,
  compact = false,
}: IssueWorkflowPanelProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const [starterStages, setStarterStages] = useState<WorkflowStarterStage[]>(() => [
    { id: "stage-1", type: "review", participantValue: "", requiredDecisions: 1 },
  ]);
  const workflowsQueryKey = queryKeys.workflows.issue(companyId, issueId);
  const { data: workflows, isLoading, error } = useQuery({
    queryKey: workflowsQueryKey,
    queryFn: () => workflowsApi.listForIssue(issueId, companyId),
    enabled: !!issueId && !!companyId,
  });
  const { data: positions = [] } = useQuery({
    queryKey: queryKeys.organization.positions(companyId),
    queryFn: () => organizationApi.listPositions(companyId),
    enabled: !!companyId,
  });
  const { data: positionAssignments = [] } = useQuery({
    queryKey: queryKeys.organization.positionAssignments(companyId),
    queryFn: () => organizationApi.listPositionAssignments(companyId),
    enabled: !!companyId,
  });

  const invalidateWorkflowSurfaces = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: workflowsQueryKey }),
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.activity(issueId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.approvals(issueId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.notificationInbox(companyId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.sidebarBadges(companyId) }),
    ]);
  };

  const activeWorkflow = useMemo(
    () => workflows?.find((workflow) => workflow.status === "active") ?? null,
    [workflows],
  );
  const positionNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const position of positions) map.set(position.id, position.name);
    return map;
  }, [positions]);
  const currentUserPositionIds = useMemo(() => new Set(
    positionAssignments
      .filter((assignment) =>
        assignment.status === "active"
        && assignment.principalType === "user"
        && assignment.principalId === currentUserId,
      )
      .map((assignment) => assignment.positionId),
  ), [currentUserId, positionAssignments]);
  const participantOptions = useMemo(
    () => buildParticipantOptions({ users, agents, positions, currentUserId, userLabelMap }),
    [agents, currentUserId, positions, userLabelMap, users],
  );

  const startWorkflow = useMutation({
    mutationFn: () => {
      const stages = starterStages.map((stage, index) => {
        const participant = parseParticipantValue(stage.participantValue);
        if (!participant) throw new Error("Choose a participant for every stage");
        return {
          key: `${stage.type}_${index + 1}`,
          type: stage.type,
          requiredDecisions: stage.requiredDecisions,
          participants: [
            {
              principalType: participant.principalType,
              principalId: participant.principalId,
              role: stage.type === "approval" ? "approver" as const : "reviewer" as const,
            },
          ],
        };
      });
      if (stages.length === 0) throw new Error("Add at least one workflow stage");
      return workflowsApi.startForIssue(issueId, companyId, {
        triggerKind: "manual",
        name: "Issue workflow",
        stages,
      });
    },
    onSuccess: async () => {
      await invalidateWorkflowSurfaces();
      pushToast({ title: "Workflow started", body: "The first stage is now waiting in the workflow inbox." });
    },
    onError: (mutationError) => {
      const message = mutationError instanceof ApiError
        ? mutationError.message
        : mutationError instanceof Error
          ? mutationError.message
          : "Failed to start workflow";
      pushToast({ title: "Workflow start failed", body: message, tone: "error" });
    },
  });

  const decideStage = useMutation({
    mutationFn: ({ stageId, decision }: { stageId: string; decision: "approved" | "rejected" | "revision_requested" }) =>
      workflowsApi.decideStage(stageId, { decision }),
    onSuccess: async () => {
      await invalidateWorkflowSurfaces();
      pushToast({ title: "Workflow updated" });
    },
    onError: (mutationError) => {
      const message = mutationError instanceof ApiError
        ? mutationError.message
        : mutationError instanceof Error
          ? mutationError.message
          : "Failed to update workflow";
      pushToast({ title: "Workflow update failed", body: message, tone: "error" });
    },
  });

  const workflowsToRender = workflows ?? [];

  return (
    <section className={cn("space-y-3", compact && "text-sm")} aria-label="Issue workflow">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <GitBranch className="h-4 w-4 text-muted-foreground" />
            <span>Workflow</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Issue-attached stages with inbox actions.
          </p>
        </div>
      </div>

      <WorkflowStarter
        stages={starterStages}
        participantOptions={participantOptions}
        disabled={Boolean(activeWorkflow) || startWorkflow.isPending}
        isStarting={startWorkflow.isPending}
        onStagesChange={setStarterStages}
        onStart={() => startWorkflow.mutate()}
      />

      {error ? (
        <p className="rounded border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Failed to load workflows.
        </p>
      ) : null}

      {isLoading ? (
        <p className="rounded border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          Loading workflows...
        </p>
      ) : workflowsToRender.length === 0 ? (
        <p className="rounded border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          No workflow has been attached to this issue yet.
        </p>
      ) : (
        <div className="space-y-3">
          {workflowsToRender.map((workflow) => (
            <WorkflowCard
              key={workflow.id}
              workflow={workflow}
              currentUserId={currentUserId}
              userLabelMap={userLabelMap}
              agentNameMap={agentNameMap}
              positionNameMap={positionNameMap}
              currentUserPositionIds={currentUserPositionIds}
              decidingStageId={decideStage.isPending ? decideStage.variables?.stageId ?? null : null}
              onDecision={(stageId, decision) => decideStage.mutate({ stageId, decision })}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function buildParticipantOptions({
  users,
  agents,
  positions,
  currentUserId,
  userLabelMap,
}: {
  users: CompanyUserDirectoryEntry[];
  agents: Agent[];
  positions: Position[];
  currentUserId: string | null;
  userLabelMap?: ReadonlyMap<string, string>;
}): WorkflowParticipantOption[] {
  const options: WorkflowParticipantOption[] = [];
  const seenUsers = new Set<string>();
  for (const user of users) {
    if (user.status !== "active" || seenUsers.has(user.principalId)) continue;
    seenUsers.add(user.principalId);
    options.push({
      value: `user:${user.principalId}`,
      label: userLabelMap?.get(user.principalId) ?? user.user?.name ?? user.user?.email ?? user.principalId,
      kind: "user",
    });
  }
  if (currentUserId && !seenUsers.has(currentUserId)) {
    options.unshift({
      value: `user:${currentUserId}`,
      label: currentUserId === "local-board" ? "Board" : currentUserId,
      kind: "user",
    });
  }
  for (const agent of agents) {
    if (agent.status === "terminated") continue;
    options.push({ value: `agent:${agent.id}`, label: agent.name, kind: "agent" });
  }
  for (const position of positions) {
    if (position.status !== "active") continue;
    options.push({ value: `position:${position.id}`, label: position.name, kind: "position" });
  }
  return options;
}

function parseParticipantValue(value: string): { principalType: "user" | "agent" | "position"; principalId: string } | null {
  const [principalType, principalId] = value.split(":");
  if (
    (principalType === "user" || principalType === "agent" || principalType === "position")
    && principalId
  ) {
    return { principalType, principalId };
  }
  return null;
}

function updateStarterStage(
  stages: WorkflowStarterStage[],
  stageId: string,
  patch: Partial<WorkflowStarterStage>,
) {
  return stages.map((stage) => stage.id === stageId ? { ...stage, ...patch } : stage);
}

function WorkflowStarter({
  stages,
  participantOptions,
  disabled,
  isStarting,
  onStagesChange,
  onStart,
}: {
  stages: WorkflowStarterStage[];
  participantOptions: WorkflowParticipantOption[];
  disabled: boolean;
  isStarting: boolean;
  onStagesChange: (stages: WorkflowStarterStage[]) => void;
  onStart: () => void;
}) {
  const canAddStage = stages.length < 2;
  const canStart = !disabled
    && participantOptions.length > 0
    && stages.every((stage) => parseParticipantValue(stage.participantValue) && stage.requiredDecisions >= 1);
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-medium">Start workflow</div>
          <div className="text-[11px] text-muted-foreground">Review or approval stages attached to this issue.</div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!canAddStage || disabled}
          onClick={() => onStagesChange([
            ...stages,
            {
              id: `stage-${stages.length + 1}-${Date.now()}`,
              type: "approval",
              participantValue: "",
              requiredDecisions: 1,
            },
          ])}
        >
          Add stage
        </Button>
      </div>

      <div className="space-y-2">
        {stages.map((stage, index) => (
          <div key={stage.id} className="space-y-2 rounded border border-border/70 bg-background px-2 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-muted-foreground">Stage {index + 1}</span>
              {stages.length > 1 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  disabled={disabled}
                  onClick={() => onStagesChange(stages.filter((item) => item.id !== stage.id))}
                >
                  Remove
                </Button>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select
                value={stage.type}
                disabled={disabled}
                onValueChange={(value) => {
                  if (value !== "review" && value !== "approval") return;
                  onStagesChange(updateStarterStage(stages, stage.id, { type: value }));
                }}
              >
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="review">Review</SelectItem>
                  <SelectItem value="approval">Approval</SelectItem>
                </SelectContent>
              </Select>
              <Input
                type="number"
                min={1}
                max={20}
                value={stage.requiredDecisions}
                disabled={disabled}
                className="h-8 text-xs"
                aria-label={`Required decisions for stage ${index + 1}`}
                onChange={(event) => {
                  const next = Number.parseInt(event.target.value, 10);
                  onStagesChange(updateStarterStage(stages, stage.id, {
                    requiredDecisions: Number.isFinite(next) ? Math.min(Math.max(next, 1), 20) : 1,
                  }));
                }}
              />
            </div>
            <Select
              value={stage.participantValue}
              disabled={disabled || participantOptions.length === 0}
              onValueChange={(value) => onStagesChange(updateStarterStage(stages, stage.id, { participantValue: value }))}
            >
              <SelectTrigger size="sm" className="w-full">
                <SelectValue placeholder={participantOptions.length > 0 ? "Choose participant" : "No participants available"} />
              </SelectTrigger>
              <SelectContent>
                {participantOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label} <span className="text-muted-foreground">({option.kind})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>

      <Button
        type="button"
        size="sm"
        className="mt-3 w-full"
        disabled={!canStart}
        onClick={onStart}
      >
        {isStarting ? "Starting..." : "Start workflow"}
      </Button>
      {disabled ? (
        <p className="mt-2 text-[11px] text-muted-foreground">Finish the active workflow before starting another one.</p>
      ) : null}
    </div>
  );
}

function WorkflowCard({
  workflow,
  currentUserId,
  userLabelMap,
  agentNameMap,
  positionNameMap,
  currentUserPositionIds,
  decidingStageId,
  onDecision,
}: {
  workflow: IssueWorkflow;
  currentUserId: string | null;
  userLabelMap?: ReadonlyMap<string, string>;
  agentNameMap?: ReadonlyMap<string, string>;
  positionNameMap?: ReadonlyMap<string, string>;
  currentUserPositionIds: ReadonlySet<string>;
  decidingStageId: string | null;
  onDecision: (stageId: string, decision: "approved" | "rejected" | "revision_requested") => void;
}) {
  const currentStage = findCurrentStage(workflow);
  return (
    <div className="rounded-md border border-border bg-background">
      <div className="flex items-start justify-between gap-3 border-b border-border/70 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {currentStage ? STAGE_TYPE_LABELS[currentStage.stageType] ?? currentStage.stageType : "Workflow"}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Started {relativeTime(workflow.createdAt)}
          </div>
        </div>
        <WorkflowStatusPill status={workflow.status} />
      </div>
      <div className="space-y-2 px-3 py-3">
        {workflow.stages.map((stage) => (
          <WorkflowStageRow
            key={stage.id}
            stage={stage}
            currentUserId={currentUserId}
            userLabelMap={userLabelMap}
            agentNameMap={agentNameMap}
            positionNameMap={positionNameMap}
            currentUserPositionIds={currentUserPositionIds}
            isDeciding={decidingStageId === stage.id}
            onDecision={onDecision}
          />
        ))}
      </div>
    </div>
  );
}

function WorkflowStageRow({
  stage,
  currentUserId,
  userLabelMap,
  agentNameMap,
  positionNameMap,
  currentUserPositionIds,
  isDeciding,
  onDecision,
}: {
  stage: WorkflowStage;
  currentUserId: string | null;
  userLabelMap?: ReadonlyMap<string, string>;
  agentNameMap?: ReadonlyMap<string, string>;
  positionNameMap?: ReadonlyMap<string, string>;
  currentUserPositionIds: ReadonlySet<string>;
  isDeciding: boolean;
  onDecision: (stageId: string, decision: "approved" | "rejected" | "revision_requested") => void;
}) {
  const currentUserParticipant = stage.participants.some(
    (participant) =>
      (participant.principalType === "user" && participant.principalId === currentUserId)
      || (participant.principalType === "position" && currentUserPositionIds.has(participant.principalId)),
  );
  const canDecide = stage.status === "in_progress" && currentUserParticipant;
  return (
    <div className="rounded border border-border/70 px-2.5 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="truncate text-xs font-medium">{stage.stageKey}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {STAGE_TYPE_LABELS[stage.stageType] ?? stage.stageType}
            </span>
            {stage.approvalId ? (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">
                Approval linked
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {STAGE_STATUS_LABELS[stage.status] ?? stage.status}
            {" · "}
            {stage.participants.filter((participant) => participant.decision === "approved").length}/{stage.requiredDecisions} required
          </div>
        </div>
      </div>

      <div className="mt-2 space-y-1.5">
        {stage.participants.map((participant) => (
          <div key={participant.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="min-w-0 truncate text-muted-foreground">
              {formatPrincipal(participant, userLabelMap, agentNameMap, positionNameMap)}
              <span className="ml-1 text-[11px]">({participant.role})</span>
            </span>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {participant.decision ? DECISION_LABELS[participant.decision] ?? participant.decision : "Waiting"}
            </span>
          </div>
        ))}
      </div>

      {canDecide ? (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isDeciding}
            onClick={() => onDecision(stage.id, "approved")}
            className="h-8 px-2 text-xs"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Approve
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isDeciding}
            onClick={() => onDecision(stage.id, "revision_requested")}
            className="h-8 px-2 text-xs"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Revise
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isDeciding}
            onClick={() => onDecision(stage.id, "rejected")}
            className="h-8 px-2 text-xs"
          >
            <XCircle className="h-3.5 w-3.5" />
            Reject
          </Button>
        </div>
      ) : null}
    </div>
  );
}
