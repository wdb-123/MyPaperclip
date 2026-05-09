import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, companies, issues } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import type { LogActivityInput } from "./activity-log.js";

const DEFAULT_ACTIVITY_ACTIONS = new Set([
  "approval.created",
  "approval.approved",
  "approval.rejected",
  "approval.revision_requested",
  "approval.resubmitted",
  "approval.requester_wakeup_failed",
  "board_api_key.created",
  "board_api_key.revoked",
  "agent_api_key.claimed",
  "invite.created",
  "invite.openclaw_prompt_created",
  "join.requested",
  "join.request_replayed",
  "join.approved",
  "join.rejected",
  "company_member.updated",
  "company_member.access_updated",
  "company_member.archived",
  "company_member.permissions_updated",
  "agent.permissions_updated",
  "budget.soft_threshold_crossed",
  "budget.hard_threshold_crossed",
  "budget.incident_resolved",
]);

type NotificationConfig = {
  feishuWebhookUrl?: string;
  feishuSecret?: string;
  actionFilter: "default" | "all" | Set<string>;
};

function readNotificationConfig(): NotificationConfig {
  const actionFilterRaw = process.env.PAPERCLIP_NOTIFICATION_ACTIONS?.trim();
  const actionFilter =
    !actionFilterRaw
      ? "default"
      : actionFilterRaw === "*"
        ? "all"
        : new Set(
          actionFilterRaw
            .split(",")
            .map((action) => action.trim())
            .filter(Boolean),
        );

  return {
    feishuWebhookUrl:
      process.env.PAPERCLIP_NOTIFICATION_FEISHU_WEBHOOK_URL?.trim() ||
      process.env.PAPERCLIP_FEISHU_WEBHOOK_URL?.trim() ||
      undefined,
    feishuSecret:
      process.env.PAPERCLIP_NOTIFICATION_FEISHU_SECRET?.trim() ||
      process.env.PAPERCLIP_FEISHU_SECRET?.trim() ||
      undefined,
    actionFilter,
  };
}

function isTaskCompletionActivity(action: string, details: Record<string, unknown> | null | undefined) {
  return action === "issue.updated" && details?.status === "done";
}

function isTaskReviewActivity(action: string, details: Record<string, unknown> | null | undefined) {
  return action === "issue.updated" && details?.status === "in_review";
}

export function shouldNotifyActivity(
  action: string,
  details: Record<string, unknown> | null | undefined,
  actionFilter: NotificationConfig["actionFilter"],
) {
  if (actionFilter === "all") return true;
  if (actionFilter instanceof Set) {
    return actionFilter.has(action);
  }
  if (DEFAULT_ACTIVITY_ACTIONS.has(action)) return true;
  if (isTaskCompletionActivity(action, details)) return true;
  if (isTaskReviewActivity(action, details)) return true;
  return action.endsWith(".failed") || action.endsWith("_failed");
}

function formatActionLabel(action: string, details: Record<string, unknown> | null | undefined) {
  if (isTaskCompletionActivity(action, details)) {
    return "任务已完成";
  }
  if (isTaskReviewActivity(action, details)) {
    return "任务已提交审核";
  }
  const labels: Record<string, string> = {
    "approval.created": "新的审批请求",
    "approval.approved": "审批已通过",
    "approval.rejected": "审批已拒绝",
    "approval.revision_requested": "审批要求修改",
    "approval.resubmitted": "审批已重新提交",
    "approval.requester_wakeup_failed": "审批后唤醒失败",
    "board_api_key.created": "Board API Key 已授权",
    "board_api_key.revoked": "Board API Key 已撤销",
    "agent_api_key.claimed": "Agent API Key 已领取",
    "invite.created": "邀请已创建",
    "invite.openclaw_prompt_created": "OpenClaw 邀请提示已创建",
    "join.requested": "新的加入申请",
    "join.request_replayed": "加入申请已重放",
    "join.approved": "加入申请已通过",
    "join.rejected": "加入申请已拒绝",
    "company_member.updated": "成员信息已更新",
    "company_member.access_updated": "成员访问权限已更新",
    "company_member.archived": "成员已归档",
    "company_member.permissions_updated": "成员权限已更新",
    "agent.permissions_updated": "代理权限已更新",
    "budget.soft_threshold_crossed": "预算预警",
    "budget.hard_threshold_crossed": "预算硬限制触发",
    "budget.incident_resolved": "预算事件已处理",
  };
  return labels[action] ?? action;
}

function formatDetails(details: Record<string, unknown> | null | undefined) {
  if (!details) return null;
  const safeDetails = Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined && value !== null),
  );
  if (Object.keys(safeDetails).length === 0) return null;
  const text = JSON.stringify(safeDetails);
  return text.length > 800 ? `${text.slice(0, 800)}...` : text;
}

function buildFeishuSignature(timestamp: string, secret: string) {
  const stringToSign = `${timestamp}\n${secret}`;
  return createHmac("sha256", stringToSign).update("").digest("base64");
}

async function postFeishuText(webhookUrl: string, text: string, secret?: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body: Record<string, unknown> = {
    msg_type: "text",
    content: { text },
  };

  if (secret) {
    body.timestamp = timestamp;
    body.sign = buildFeishuSignature(timestamp, secret);
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Feishu webhook returned ${response.status}`);
  }

  const responseText = await response.text();
  if (!responseText) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return;
  }

  if (!parsed || typeof parsed !== "object") return;
  const responseBody = parsed as { code?: unknown; StatusCode?: unknown; msg?: unknown; StatusMessage?: unknown };
  const code =
    typeof responseBody.code === "number"
      ? responseBody.code
      : typeof responseBody.StatusCode === "number"
        ? responseBody.StatusCode
        : 0;
  if (code !== 0) {
    const message =
      typeof responseBody.msg === "string"
        ? responseBody.msg
        : typeof responseBody.StatusMessage === "string"
          ? responseBody.StatusMessage
          : `code ${code}`;
    throw new Error(`Feishu webhook rejected message: ${message}`);
  }
}

async function getCompanyName(db: Db, companyId: string) {
  const [company] = await db
    .select({ name: companies.name })
    .from(companies)
    .where(and(eq(companies.id, companyId)))
    .limit(1);
  return company?.name ?? companyId;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function getIssueSummary(db: Db, issueId: string, details: Record<string, unknown> | null | undefined) {
  const detailsIdentifier = readString(details?.identifier);
  const detailsTitle = readString(details?.issueTitle) ?? readString(details?.title);
  const detailsDescription = readString(details?.issueDescription) ?? readString(details?.description);
  if (detailsIdentifier && detailsTitle && detailsDescription) {
    return { identifier: detailsIdentifier, title: detailsTitle, description: detailsDescription };
  }

  const [issue] = await db
    .select({ identifier: issues.identifier, title: issues.title, description: issues.description })
    .from(issues)
    .where(eq(issues.id, issueId))
    .limit(1);

  return {
    identifier: detailsIdentifier ?? issue?.identifier ?? null,
    title: detailsTitle ?? issue?.title ?? null,
    description: detailsDescription ?? issue?.description ?? null,
  };
}

async function getAgentName(db: Db, agentId: string | null | undefined) {
  if (!agentId) return null;
  const [agent] = await db
    .select({ name: agents.name })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  return agent?.name ?? null;
}

function truncateLine(value: string, maxLength = 240) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

async function formatEntityLines(db: Db, input: LogActivityInput, details: Record<string, unknown> | null) {
  if (input.entityType === "issue") {
    const issue = await getIssueSummary(db, input.entityId, details);
    const label = [issue.identifier, issue.title].filter(Boolean).join(" - ");
    return [
      label ? `任务：${label} (${input.entityId})` : `任务：${input.entityId}`,
      issue.description ? `描述：${truncateLine(issue.description)}` : null,
    ].filter((line): line is string => Boolean(line));
  }
  return [`对象：${input.entityType}/${input.entityId}`];
}

export async function notifyActivity(db: Db, input: LogActivityInput, details: Record<string, unknown> | null) {
  const config = readNotificationConfig();
  if (!config.feishuWebhookUrl) return;
  if (!shouldNotifyActivity(input.action, details, config.actionFilter)) return;

  const companyName = await getCompanyName(db, input.companyId);
  const entityLines = await formatEntityLines(db, input, details);
  const agentName = await getAgentName(db, input.agentId);
  const actorAgentName = input.actorType === "agent" ? await getAgentName(db, input.actorId) : null;
  const detailText = formatDetails(details);
  const lines = [
    `Paperclip 通知：${formatActionLabel(input.action, details)}`,
    `公司：${companyName}`,
    ...entityLines,
    `触发者：${input.actorType}/${actorAgentName ? `${actorAgentName} (${input.actorId})` : input.actorId}`,
    input.agentId ? `代理：${agentName ? `${agentName} (${input.agentId})` : input.agentId}` : null,
    input.runId ? `运行：${input.runId}` : null,
    detailText ? `详情：${detailText}` : null,
    `时间：${new Date().toISOString()}`,
  ].filter((line): line is string => Boolean(line));

  await postFeishuText(config.feishuWebhookUrl, lines.join("\n"), config.feishuSecret);
}

export function notifyActivityInBackground(db: Db, input: LogActivityInput, details: Record<string, unknown> | null) {
  void notifyActivity(db, input, details).catch((err) => {
    logger.warn({ err, action: input.action, companyId: input.companyId }, "failed to send activity notification");
  });
}
