import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, GitBranch, RotateCcw, XCircle } from "lucide-react";
import { ApiError } from "../api/client";
import { workflowsApi, type IssueWorkflow, type WorkflowParticipant, type WorkflowStage } from "../api/workflows";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { cn, relativeTime } from "../lib/utils";
import { Button } from "@/components/ui/button";

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

function formatPrincipal(participant: WorkflowParticipant, userLabelMap?: ReadonlyMap<string, string>, agentNameMap?: ReadonlyMap<string, string>) {
  if (participant.principalType === "user") return userLabelMap?.get(participant.principalId) ?? "User";
  if (participant.principalType === "agent") return agentNameMap?.get(participant.principalId) ?? "Agent";
  return "Position";
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
  userLabelMap?: ReadonlyMap<string, string>;
  agentNameMap?: ReadonlyMap<string, string>;
  compact?: boolean;
}

export function IssueWorkflowPanel({
  issueId,
  companyId,
  currentUserId,
  userLabelMap,
  agentNameMap,
  compact = false,
}: IssueWorkflowPanelProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const workflowsQueryKey = queryKeys.workflows.issue(companyId, issueId);
  const { data: workflows, isLoading, error } = useQuery({
    queryKey: workflowsQueryKey,
    queryFn: () => workflowsApi.listForIssue(issueId, companyId),
    enabled: !!issueId && !!companyId,
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

  const startReview = useMutation({
    mutationFn: () => {
      if (!currentUserId) throw new Error("No current user");
      return workflowsApi.startForIssue(issueId, companyId, {
        triggerKind: "manual",
        name: "Board review",
        stages: [
          {
            key: "board_review",
            type: "review",
            requiredDecisions: 1,
            participants: [
              { principalType: "user", principalId: currentUserId, role: "reviewer" },
            ],
          },
        ],
      });
    },
    onSuccess: async () => {
      await invalidateWorkflowSurfaces();
      pushToast({ title: "Workflow started", body: "Review is now waiting in the workflow inbox." });
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
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!currentUserId || Boolean(activeWorkflow) || startReview.isPending}
          onClick={() => startReview.mutate()}
        >
          {startReview.isPending ? "Starting..." : "Start review"}
        </Button>
      </div>

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
              decidingStageId={decideStage.isPending ? decideStage.variables?.stageId ?? null : null}
              onDecision={(stageId, decision) => decideStage.mutate({ stageId, decision })}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function WorkflowCard({
  workflow,
  currentUserId,
  userLabelMap,
  agentNameMap,
  decidingStageId,
  onDecision,
}: {
  workflow: IssueWorkflow;
  currentUserId: string | null;
  userLabelMap?: ReadonlyMap<string, string>;
  agentNameMap?: ReadonlyMap<string, string>;
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
  isDeciding,
  onDecision,
}: {
  stage: WorkflowStage;
  currentUserId: string | null;
  userLabelMap?: ReadonlyMap<string, string>;
  agentNameMap?: ReadonlyMap<string, string>;
  isDeciding: boolean;
  onDecision: (stageId: string, decision: "approved" | "rejected" | "revision_requested") => void;
}) {
  const currentUserParticipant = stage.participants.some(
    (participant) => participant.principalType === "user" && participant.principalId === currentUserId,
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
              {formatPrincipal(participant, userLabelMap, agentNameMap)}
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
