import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyActivity, shouldNotifyActivity } from "../services/notifications.js";

function createDb(rows: unknown[][] = [[{ name: "Acme" }]]) {
  const queue = [...rows];
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => queue.shift() ?? []),
        })),
      })),
    })),
  } as any;
}

describe("notifications service", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.unstubAllEnvs();
    global.fetch = vi.fn(async () => new Response(null, { status: 200 })) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("includes permission updates in the default notification policy", () => {
    expect(shouldNotifyActivity("company_member.permissions_updated", null, "default")).toBe(true);
    expect(shouldNotifyActivity("agent.permissions_updated", null, "default")).toBe(true);
    expect(shouldNotifyActivity("company_member.access_updated", null, "default")).toBe(true);
    expect(shouldNotifyActivity("company_member.updated", null, "default")).toBe(true);
    expect(shouldNotifyActivity("company_member.archived", null, "default")).toBe(true);
    expect(shouldNotifyActivity("join.requested", null, "default")).toBe(true);
    expect(shouldNotifyActivity("join.approved", null, "default")).toBe(true);
    expect(shouldNotifyActivity("board_api_key.created", null, "default")).toBe(true);
    expect(shouldNotifyActivity("agent_api_key.claimed", null, "default")).toBe(true);
  });

  it("includes task completion in the default notification policy", () => {
    expect(shouldNotifyActivity("issue.updated", { status: "done" }, "default")).toBe(true);
    expect(shouldNotifyActivity("issue.updated", { status: "in_review" }, "default")).toBe(true);
    expect(shouldNotifyActivity("issue.updated", { status: "in_progress" }, "default")).toBe(false);
  });

  it("posts a webhook for a completed task when Feishu is configured", async () => {
    vi.stubEnv("PAPERCLIP_NOTIFICATION_FEISHU_WEBHOOK_URL", "https://example.test/webhook");
    const db = createDb([
      [{ name: "Acme" }],
      [{ identifier: "ARA-15", title: "Verify Feishu notifications", description: "Send a readable task completion notice to Feishu." }],
      [{ name: "Backend Engineer" }],
      [{ name: "Backend Engineer" }],
    ]);

    await notifyActivity(
      db,
      {
        companyId: "company-1",
        actorType: "agent",
        actorId: "agent-1",
        agentId: "agent-1",
        action: "issue.updated",
        entityType: "issue",
        entityId: "issue-1",
      },
      {
        status: "done",
        identifier: "ARA-15",
      },
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://example.test/webhook",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    );

    const [, requestInit] = vi.mocked(global.fetch).mock.calls[0] ?? [];
    expect(typeof requestInit?.body).toBe("string");
    const requestBody = JSON.parse(String(requestInit?.body)) as { content?: { text?: string } };
    expect(requestBody.content?.text).toContain("任务已完成");
    expect(requestBody.content?.text).toContain("任务：ARA-15 - Verify Feishu notifications (issue-1)");
    expect(requestBody.content?.text).toContain("描述：Send a readable task completion notice to Feishu.");
    expect(requestBody.content?.text).toContain("触发者：agent/Backend Engineer (agent-1)");
    expect(requestBody.content?.text).toContain("代理：Backend Engineer (agent-1)");
    expect(requestBody.content?.text).toContain("\"status\":\"done\"");
  });
});
