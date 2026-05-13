# Human Organization Workflow Plan

Date: 2026-05-09
Status: proposal

## Goal

Add a company-wide collaboration layer for departments with many human operators, many roles, multi-level task delegation, and human review at each management node.

This should extend Paperclip's existing company, agent org chart, issue, approval, permission, activity log, and notification systems. It should not replace the current control-plane model.

## Product Shape

Paperclip should support a mixed human/agent organization:

- A director can issue work to multiple middle managers.
- Middle managers can break work down and assign it to their own reports.
- Each node can require a human review or approval gate before work moves upward or downward.
- Messages route to the exact people responsible for the next action.
- The full chain remains auditable: who assigned, who reviewed, who approved, who rejected, who completed.

This is not generic chat. Conversation remains attached to work objects: companies, departments, positions, issues, approvals, comments, and notifications.

## Current Baseline

The repo already has useful foundations:

- `companies`: first-order company scope.
- `company_memberships`: company membership for human and non-human principals.
- `principal_permission_grants`: company-scoped permission grants.
- `agents.reports_to`: AI-agent reporting tree.
- `issues.parent_id`: hierarchical work decomposition.
- `issues.assignee_agent_id` and `issues.assignee_user_id`: single-assignee task ownership by agent or human.
- `issues.execution_policy` and `issues.execution_state`: structured execution/review state.
- `approvals`, `approval_comments`, `issue_approvals`: approval lifecycle and issue linkage.
- `activity_log`: audit trail.
- Feishu notification service: outbound status, approval, permission, and task notifications.

The main missing piece is a first-class human organization and workflow layer.

## Non-Goals

- Do not turn Paperclip into a general chat app.
- Do not replace issues with a new task engine.
- Do not remove the single-assignee issue invariant.
- Do not require enterprise RBAC before the first usable slice.
- Do not make every deployment SaaS multi-tenant. This plan is about company-internal organization workflow.

## Governance Boundaries

This work must extend the existing Paperclip control plane instead of creating parallel systems.

Company remains the hard boundary for every object in this plan. Departments, positions, position assignments, workflow templates, workflow instances, workflow stages, workflow participants, approvals, notifications, and activity entries must never cross company boundaries.

Issues keep the existing single-assignee model. Selecting a position for issue assignment is a routing convenience only: the server must eventually resolve that selection to exactly one `assignee_user_id` or one `assignee_agent_id`. A position must not become a second worker identity on an issue.

Positions represent responsibilities or seats in the organization. They are not execution principals. Work is still executed by a concrete user or agent occupying a position, and the assignment state must remain inspectable through `position_assignments`.

Approvals remain the authoritative governance object. Workflow stages may coordinate review and approval order, but workflow must not become a second approval system. A workflow `approval` stage must create or link an existing `approvals.id`; approval decisions must be written to `approvals.status`, with `workflow_participants.decision` used only as a participant record or snapshot.

Workflow is an issue-attached stage pipeline. It may sequence assignment, review, approval, and notification stages, but core side effects must land in existing systems: issue status and assignment fields, approvals, activity log, notifications, and heartbeat wakeups.

UI may expose departments, positions, and workflow stages, but UI-only interpretation is not sufficient for durable behavior. API clients, agents, and plugins must be able to use the same server-side assignment and approval semantics.

## Core Concepts

### Department

A company-scoped organizational grouping. Departments affect organization management, visibility, and presentation; they do not execute work and they do not replace companies as the security boundary.

Suggested table: `departments`

- `id uuid pk`
- `company_id uuid not null`
- `parent_department_id uuid null`
- `name text not null`
- `description text null`
- `status text not null default 'active'`
- `created_at timestamptz`
- `updated_at timestamptz`

Indexes:

- `(company_id, parent_department_id)`
- `(company_id, status)`

### Position

A responsibility node inside a department. A position can be occupied by a user or an agent through `position_assignments`, but it is not itself a worker. Issue assignment by position must resolve to the current occupant before writing the issue assignee fields.

Suggested table: `positions`

- `id uuid pk`
- `company_id uuid not null`
- `department_id uuid null`
- `reports_to_position_id uuid null`
- `name text not null`
- `description text null`
- `responsibilities text null`
- `approval_authority jsonb not null default '{}'`
- `status text not null default 'active'`
- `created_at timestamptz`
- `updated_at timestamptz`

Indexes:

- `(company_id, department_id)`
- `(company_id, reports_to_position_id)`
- `(company_id, status)`

### Position Assignment

Binds a human user or AI agent to a position.

Suggested table: `position_assignments`

- `id uuid pk`
- `company_id uuid not null`
- `position_id uuid not null`
- `principal_type text not null` (`user`, `agent`)
- `principal_id text not null`
- `status text not null default 'active'`
- `started_at timestamptz not null default now()`
- `ended_at timestamptz null`
- `created_at timestamptz`
- `updated_at timestamptz`

Indexes:

- unique active assignment per `(company_id, position_id, principal_type, principal_id)`
- `(company_id, principal_type, principal_id, status)`

### Workflow Template

Reusable company-scoped workflow definitions for common task paths.

Suggested table: `workflow_templates`

- `id uuid pk`
- `company_id uuid not null`
- `name text not null`
- `description text null`
- `trigger_kind text not null` (`manual`, `issue_status`, `approval_type`)
- `definition jsonb not null`
- `status text not null default 'active'`
- `created_at timestamptz`
- `updated_at timestamptz`

The `definition` should contain ordered stages:

```json
{
  "stages": [
    {
      "key": "manager_review",
      "type": "review",
      "assignee": { "kind": "position_manager" },
      "policy": { "mode": "single", "requiredApprovals": 1 },
      "onApprove": "next",
      "onReject": "return_to_previous"
    }
  ]
}
```

### Workflow Instance

The live stage pipeline attached to a specific issue or approval. Workflow instance state tracks orchestration progress only; it does not replace approval records, issue state, notifications, or activity logging.

Suggested table: `workflow_instances`

- `id uuid pk`
- `company_id uuid not null`
- `template_id uuid null`
- `subject_type text not null` (`issue`, `approval`)
- `subject_id uuid not null`
- `status text not null` (`active`, `completed`, `cancelled`, `failed`)
- `current_stage_key text null`
- `created_by_user_id text null`
- `created_by_agent_id uuid null`
- `created_at timestamptz`
- `updated_at timestamptz`

Indexes:

- `(company_id, subject_type, subject_id)`
- `(company_id, status, updated_at desc)`

### Workflow Stage Instance

Tracks every review or approval step.

Suggested table: `workflow_stage_instances`

- `id uuid pk`
- `company_id uuid not null`
- `workflow_instance_id uuid not null`
- `stage_key text not null`
- `stage_type text not null` (`assignment`, `review`, `approval`, `notification`)
- `status text not null` (`pending`, `in_progress`, `approved`, `rejected`, `skipped`, `cancelled`)
- `required_decisions integer not null default 1`
- `due_at timestamptz null`
- `completed_at timestamptz null`
- `created_at timestamptz`
- `updated_at timestamptz`

### Workflow Participant

The people or agents responsible for a stage.

Participant decisions are stage-local records. For approval stages, the authoritative decision must live on the linked `approvals` record, and participant rows should be treated as attribution/snapshot data.

Suggested table: `workflow_participants`

- `id uuid pk`
- `company_id uuid not null`
- `stage_instance_id uuid not null`
- `principal_type text not null` (`user`, `agent`, `position`)
- `principal_id text not null`
- `role text not null` (`assignee`, `reviewer`, `approver`, `observer`)
- `decision text null` (`approved`, `rejected`, `revision_requested`)
- `decision_note text null`
- `decided_at timestamptz null`
- `created_at timestamptz`
- `updated_at timestamptz`

Indexes:

- `(company_id, principal_type, principal_id, role)`
- `(company_id, stage_instance_id, role)`

### Notification Inbox

Feishu is an outbound integration. Paperclip also needs a durable internal inbox so message routing is inspectable and retryable.

Suggested table: `notification_inbox_items`

- `id uuid pk`
- `company_id uuid not null`
- `recipient_type text not null` (`user`, `agent`, `position`)
- `recipient_id text not null`
- `subject_type text not null`
- `subject_id text not null`
- `action_key text not null`
- `title text not null`
- `body text null`
- `status text not null` (`unread`, `read`, `handled`, `dismissed`)
- `requires_action boolean not null default false`
- `delivery_channels jsonb not null default '[]'`
- `delivered_at timestamptz null`
- `read_at timestamptz null`
- `handled_at timestamptz null`
- `created_at timestamptz`
- `updated_at timestamptz`

## How It Fits Existing Systems

### Issues

Keep issue single-assignee behavior.

Add optional links:

- `department_id`
- `position_id`
- `workflow_instance_id`

The assignee stays either `assignee_user_id` or `assignee_agent_id`. Department and position provide routing and governance context. A position selection must be resolved server-side before issue creation or update is committed.

### Approvals

Keep the existing `approvals` table for approval records.

Workflow stages can create or link existing approvals. This avoids duplicating approval logic while enabling multi-step chains.

Approval stages must not complete purely by updating `workflow_participants.decision`. The `approvals` row remains the source of truth for pending, approved, rejected, revision-requested, and cancelled states. Sidebar badges, notifications, activity, and wakeup logic should continue to observe the existing approval path.

### Permissions

Use `principal_permission_grants` for enforcement.

Add helper resolution:

- user -> active company memberships
- user -> active position assignments
- position -> permission grants
- department manager -> scoped permission to department subtree

### Notifications

Keep the Feishu webhook service as a delivery channel.

Add a notification router that:

1. Creates `notification_inbox_items`.
2. Sends Feishu messages when recipient or company settings allow it.
3. Includes subject title, issue identifier, stage name, requester, assignee, reviewer, and action URL.
4. Records delivery status and errors.

### Activity Log

Every workflow mutation must write activity:

- `workflow.created`
- `workflow.stage_started`
- `workflow.stage_decided`
- `workflow.stage_escalated`
- `workflow.completed`
- `notification.created`
- `notification.delivered`
- `notification.failed`

## Example Flow

Director assigns a strategic task:

1. Director creates parent issue.
2. Workflow routes it to three middle manager positions.
3. Each middle manager receives an inbox item and Feishu notification.
4. Middle manager decomposes into child issues.
5. Each child issue is assigned to a human or AI agent.
6. Executor completes child issue and moves it to review.
7. Workflow routes review to the middle manager.
8. Middle manager approves or requests changes.
9. Once all child branches are approved, parent stage moves back to director.
10. Director performs final review and closes parent task.

## API Surface

Suggested first endpoints:

- `GET /api/companies/:companyId/departments`
- `POST /api/companies/:companyId/departments`
- `PATCH /api/departments/:departmentId`
- `GET /api/companies/:companyId/positions`
- `POST /api/companies/:companyId/positions`
- `PATCH /api/positions/:positionId`
- `POST /api/positions/:positionId/assignments`
- `DELETE /api/positions/:positionId/assignments/:assignmentId`
- `GET /api/companies/:companyId/workflow-templates`
- `POST /api/companies/:companyId/workflow-templates`
- `POST /api/issues/:issueId/workflows`
- `GET /api/issues/:issueId/workflows`
- `POST /api/workflow-stages/:stageId/decisions`
- `GET /api/companies/:companyId/inbox`
- `POST /api/inbox-items/:itemId/read`
- `POST /api/inbox-items/:itemId/handle`

## UI Surface

### Company Organization

Add a company org page that can switch between:

- Agent org chart
- Human department chart
- Mixed position chart

### Issue Detail

Add workflow panel:

- current stage
- required participants
- pending decisions
- decision history
- next action

### Inbox

Upgrade inbox from badges/alerts into a real action queue:

- My approvals
- My reviews
- Mentions
- Failed runs
- Permission requests
- Department tasks

### Settings

Add company settings for:

- default workflow templates
- Feishu delivery rules
- escalation timeout policy
- department-level visibility rules

## Rollout Plan

### Phase 1: Human Organization Foundation

- Add departments, positions, and position assignments.
- Add API and UI CRUD.
- Show mixed org chart.
- No workflow automation yet.

### Phase 2: Workflow Engine Slice

- Add workflow templates and workflow instances.
- Support sequential review/approval stages.
- Link workflows to issues.
- Add decision API and activity logs.

Initial API slice landed:

- Workflow tables: templates, instances, stage instances, participants.
- `POST /api/issues/:issueId/workflows?companyId=...` starts an issue workflow.
- `GET /api/issues/:issueId/workflows?companyId=...` reads workflow state with stages and participants.
- `POST /api/workflow-stages/:stageId/decisions` records participant decisions and advances or completes the workflow.

Governance follow-up required before UI expansion:

- `decideStage()` now runs in a transaction with conditional updates for the current `in_progress` stage.
- Define `revision_requested` as a stage, issue, and approval transition, not only a participant decision.
- Workflow `approval` stages now create linked `approvals` and `issue_approvals` rows; workflow decisions update `approvals.status` and emit `approval.*` activity.
- Move position assignment resolution into a server-side helper used by issue create/update routes.
- Workflow stages now have explicit `stage_order`; pipeline order must not depend on timestamp ordering.

Organization governance constraints landed:

- `departments.parent_department_id` rejects cycles.
- `positions.reports_to_position_id` rejects cycles.
- Active assignments cannot be created for archived positions.
- Ending an assignment auto-fills `ended_at` when it was omitted.
- Position assignment principals must belong to the same company.

### Phase 3: Inbox And Feishu Routing

- Add durable inbox items.
- Route workflow stage events to users/positions.
- Send enriched Feishu messages with action URLs.
- Add delivery status and retry logs.

### Phase 4: Department-Scoped Permissions

- Resolve permissions through position and department.
- Enforce department-subtree visibility.
- Add tests for cross-department access.

### Phase 5: Advanced Approval Policies

- Parallel approvals.
- Quorum approvals.
- Delegate/backup approvers.
- Due dates and escalation.
- Reject-to-specific-stage behavior.

## Verification Strategy

Targeted tests:

- schema migration smoke test
- department tree validation
- position assignment validation
- workflow stage transition tests
- approval linkage tests
- notification routing tests
- Feishu payload formatting tests
- permission enforcement tests

Critical invariants:

- No workflow may cross company boundaries.
- No department, position, participant, approval, or inbox item may point to a subject in another company.
- An issue still has one active assignee.
- A human decision must be attributable to a user id.
- Workflow-generated notifications must be durable before external delivery is attempted.

## Open Questions

1. Should departments contain agents directly, or only positions that can be filled by humans or agents?
2. Should a user be allowed to hold multiple active positions in the same company?
3. Should Feishu action buttons approve directly, or only deep-link back into Paperclip for approval?
4. Should department visibility default to open within company or restricted by subtree?
5. Should workflow templates be mandatory for all issues, or optional per issue/project?
