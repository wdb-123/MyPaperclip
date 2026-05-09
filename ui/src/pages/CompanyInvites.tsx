import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, MailPlus } from "lucide-react";
import { accessApi } from "@/api/access";
import { ApiError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useCompany } from "@/context/CompanyContext";
import { useLanguage, type AppLanguage } from "@/context/LanguageContext";
import { useToast } from "@/context/ToastContext";
import { Link } from "@/lib/router";
import { queryKeys } from "@/lib/queryKeys";

const inviteRoleOptions = [
  {
    value: "viewer",
    label: { zh: "查看者", en: "Viewer" },
    description: {
      zh: "可以查看公司工作并跟进进展，但没有操作权限。",
      en: "Can view company work and follow progress, without operator permissions.",
    },
    gets: { zh: "无内置授权。", en: "No built-in grants." },
  },
  {
    value: "operator",
    label: { zh: "操作员", en: "Operator" },
    description: {
      zh: "适合需要协助推进工作、但不负责访问管理的成员。",
      en: "For members who help move work forward without managing access.",
    },
    gets: { zh: "可以分配任务。", en: "Can assign tasks." },
  },
  {
    value: "admin",
    label: { zh: "管理员", en: "Admin" },
    description: {
      zh: "适合需要邀请成员、创建代理并审批加入请求的操作员。",
      en: "For operators who need to invite members, create agents, and approve join requests.",
    },
    gets: {
      zh: "可以创建代理、邀请用户、分配任务并审批加入请求。",
      en: "Can create agents, invite users, assign tasks, and approve join requests.",
    },
  },
  {
    value: "owner",
    label: { zh: "所有者", en: "Owner" },
    description: {
      zh: "拥有完整公司访问权限，包括成员和权限管理。",
      en: "Has full company access, including member and permission management.",
    },
    gets: {
      zh: "包含管理员全部权限，并可管理成员和权限授权。",
      en: "Includes all admin permissions and can manage members and grants.",
    },
  },
] as const;

const INVITE_HISTORY_PAGE_SIZE = 5;

function isInviteHistoryRow(value: unknown): value is Awaited<ReturnType<typeof accessApi.listInvites>>["invites"][number] {
  if (!value || typeof value !== "object") return false;
  return "id" in value && "state" in value && "createdAt" in value;
}

export function CompanyInvites() {
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { language, t } = useLanguage();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  const [humanRole, setHumanRole] = useState<"owner" | "admin" | "operator" | "viewer">("operator");
  const [latestInviteUrl, setLatestInviteUrl] = useState<string | null>(null);
  const [latestInviteCopied, setLatestInviteCopied] = useState(false);

  useEffect(() => {
    if (!latestInviteCopied) return;
    const timeout = window.setTimeout(() => {
      setLatestInviteCopied(false);
    }, 1600);
    return () => window.clearTimeout(timeout);
  }, [latestInviteCopied]);

  async function copyInviteUrl(url: string) {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        return true;
      }
    } catch {
      // Fall through to the unavailable message below.
    }

    pushToast({
      title: t("剪贴板不可用", "Clipboard unavailable"),
      body: t("剪贴板不可用，请从下方字段手动复制邀请 URL。", "Clipboard is unavailable. Copy the invite URL manually from the field below."),
      tone: "warn",
    });
    return false;
  }

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? t("公司", "Company"), href: "/dashboard" },
      { label: t("设置", "Settings"), href: "/company/settings" },
      { label: t("邀请", "Invites") },
    ]);
  }, [selectedCompany?.name, setBreadcrumbs, t]);

  const inviteHistoryQueryKey = queryKeys.access.invites(selectedCompanyId ?? "", "all", INVITE_HISTORY_PAGE_SIZE);
  const invitesQuery = useInfiniteQuery({
    queryKey: inviteHistoryQueryKey,
    queryFn: ({ pageParam }) =>
      accessApi.listInvites(selectedCompanyId!, {
        limit: INVITE_HISTORY_PAGE_SIZE,
        offset: pageParam,
      }),
    enabled: !!selectedCompanyId,
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
  });
  const inviteHistory = useMemo(
    () =>
      invitesQuery.data?.pages.flatMap((page) =>
        Array.isArray(page?.invites) ? page.invites.filter(isInviteHistoryRow) : [],
      ) ?? [],
    [invitesQuery.data?.pages],
  );

  const createInviteMutation = useMutation({
    mutationFn: () =>
      accessApi.createCompanyInvite(selectedCompanyId!, {
        allowedJoinTypes: "human",
        humanRole,
        agentMessage: null,
      }),
    onSuccess: async (invite) => {
      setLatestInviteUrl(invite.inviteUrl);
      setLatestInviteCopied(false);
      const copied = await copyInviteUrl(invite.inviteUrl);

      await queryClient.invalidateQueries({ queryKey: inviteHistoryQueryKey });
      pushToast({
        title: t("邀请已创建", "Invite created"),
        body: copied
          ? t("邀请已生成并复制到剪贴板。", "Invite generated and copied to the clipboard.")
          : t("邀请已在下方生成。", "Invite generated below."),
        tone: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: t("创建邀请失败", "Failed to create invite"),
        body: error instanceof Error ? error.message : t("未知错误", "Unknown error"),
        tone: "error",
      });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (inviteId: string) => accessApi.revokeInvite(inviteId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: inviteHistoryQueryKey });
      pushToast({ title: t("邀请已撤销", "Invite revoked"), tone: "success" });
    },
    onError: (error) => {
      pushToast({
        title: t("撤销邀请失败", "Failed to revoke invite"),
        body: error instanceof Error ? error.message : t("未知错误", "Unknown error"),
        tone: "error",
      });
    },
  });

  if (!selectedCompanyId) {
    return <div className="text-sm text-muted-foreground">{t("选择公司以管理邀请。", "Select a company to manage invites.")}</div>;
  }

  if (invitesQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">{t("正在加载邀请...", "Loading invites...")}</div>;
  }

  if (invitesQuery.error) {
    const message =
      invitesQuery.error instanceof ApiError && invitesQuery.error.status === 403
        ? t("你没有权限管理公司邀请。", "You do not have permission to manage company invites.")
        : invitesQuery.error instanceof Error
          ? invitesQuery.error.message
          : t("加载邀请失败。", "Failed to load invites.");
    return <div className="text-sm text-destructive">{message}</div>;
  }

  return (
    <div className="max-w-5xl space-y-8">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <MailPlus className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">{t("公司邀请", "Company Invites")}</h1>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t(
            "创建用于公司访问的人类成员邀请链接。新邀请链接生成后会复制到剪贴板。",
            "Create human member invite links for company access. New invite links are copied to the clipboard after they are generated.",
          )}
        </p>
      </div>

      <section className="space-y-4 rounded-xl border border-border p-5">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">{t("创建邀请", "Create Invite")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("生成一个人类成员邀请链接，并选择默认请求的访问权限。", "Generate a human member invite link and choose the default requested access.")}
          </p>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">{t("选择角色", "Choose Role")}</legend>
          <div className="rounded-xl border border-border">
            {inviteRoleOptions.map((option, index) => {
              const checked = humanRole === option.value;
              return (
                <label
                  key={option.value}
                  className={`flex cursor-pointer gap-3 px-4 py-4 ${index > 0 ? "border-t border-border" : ""}`}
                >
                  <input
                    type="radio"
                    name="invite-role"
                    value={option.value}
                    checked={checked}
                    onChange={() => setHumanRole(option.value)}
                    className="mt-1 h-4 w-4 border-border text-foreground"
                  />
                  <span className="min-w-0 space-y-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{option.label[language]}</span>
                      {option.value === "operator" ? (
                        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                          {t("默认", "Default")}
                        </span>
                      ) : null}
                    </span>
                    <span className="block max-w-2xl text-sm text-muted-foreground">{option.description[language]}</span>
                    <span className="block text-sm text-foreground">{option.gets[language]}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground">
          {t(
            "每个邀请链接只能使用一次。首次成功使用会消耗该链接，并在审批前创建或复用匹配的加入请求。",
            "Each invite link can only be used once. The first successful use consumes the link and creates or reuses a matching join request before approval.",
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => createInviteMutation.mutate()} disabled={createInviteMutation.isPending}>
            {createInviteMutation.isPending ? t("正在创建...", "Creating...") : t("创建邀请", "Create Invite")}
          </Button>
          <span className="text-sm text-muted-foreground">{t("下方邀请历史会保留审计记录。", "The invite history below keeps an audit trail.")}</span>
        </div>

        {latestInviteUrl ? (
          <div className="space-y-3 rounded-lg border border-border px-4 py-4">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">{t("最新邀请链接", "Latest Invite Link")}</div>
                {latestInviteCopied ? (
                  <div className="inline-flex items-center gap-1 text-xs font-medium text-foreground">
                    <Check className="h-3.5 w-3.5" />
                    {t("已复制", "Copied")}
                  </div>
                ) : null}
              </div>
              <div className="text-sm text-muted-foreground">
                {t("此 URL 包含服务器返回的当前 Paperclip 域名。", "This URL includes the current Paperclip host returned by the server.")}
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                const copied = await copyInviteUrl(latestInviteUrl);
                setLatestInviteCopied(copied);
              }}
              className="w-full rounded-md border border-border bg-muted/60 px-3 py-2 text-left text-sm break-all transition-colors hover:bg-background"
            >
              {latestInviteUrl}
            </button>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" asChild>
                <a href={latestInviteUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  {t("打开邀请", "Open Invite")}
                </a>
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-border">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">{t("邀请历史", "Invite History")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("查看邀请状态、角色、邀请人以及关联的加入请求。", "Review invite state, role, inviter, and related join requests.")}
            </p>
          </div>
          <Link to="/inbox/requests" className="text-sm underline underline-offset-4">
            {t("打开加入请求队列", "Open Join Request Queue")}
          </Link>
        </div>

        {inviteHistory.length === 0 ? (
          <div className="border-t border-border px-5 py-8 text-sm text-muted-foreground">
            {t("此公司尚未创建邀请。", "No invites have been created for this company yet.")}
          </div>
        ) : (
          <div className="border-t border-border">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-5 py-3 font-medium text-muted-foreground">{t("状态", "State")}</th>
                    <th className="px-5 py-3 font-medium text-muted-foreground">{t("角色", "Role")}</th>
                    <th className="px-5 py-3 font-medium text-muted-foreground">{t("邀请人", "Inviter")}</th>
                    <th className="px-5 py-3 font-medium text-muted-foreground">{t("创建时间", "Created")}</th>
                    <th className="px-5 py-3 font-medium text-muted-foreground">{t("加入请求", "Join Request")}</th>
                    <th className="px-5 py-3 text-right font-medium text-muted-foreground">{t("操作", "Actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {inviteHistory.map((invite) => (
                    <tr key={invite.id} className="border-b border-border last:border-b-0">
                      <td className="px-5 py-3 align-top">
                        <span className="inline-flex rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                          {formatInviteState(invite.state, language)}
                        </span>
                      </td>
                      <td className="px-5 py-3 align-top">{formatInviteRole(invite.humanRole, language)}</td>
                      <td className="px-5 py-3 align-top">
                        <div>{invite.invitedByUser?.name || invite.invitedByUser?.email || t("未知邀请人", "Unknown inviter")}</div>
                        {invite.invitedByUser?.email && invite.invitedByUser.name ? (
                          <div className="text-xs text-muted-foreground">{invite.invitedByUser.email}</div>
                        ) : null}
                      </td>
                      <td className="px-5 py-3 align-top text-muted-foreground">
                        {new Date(invite.createdAt).toLocaleString()}
                      </td>
                      <td className="px-5 py-3 align-top">
                        {invite.relatedJoinRequestId ? (
                          <Link to="/inbox/requests" className="underline underline-offset-4">
                            {t("查看请求", "View Request")}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right align-top">
                        {invite.state === "active" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => revokeMutation.mutate(invite.id)}
                            disabled={revokeMutation.isPending}
                          >
                            {t("撤销", "Revoke")}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">{t("非活跃", "Inactive")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {invitesQuery.hasNextPage ? (
              <div className="flex justify-center border-t border-border px-5 py-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => invitesQuery.fetchNextPage()}
                  disabled={invitesQuery.isFetchingNextPage}
                >
                  {invitesQuery.isFetchingNextPage ? t("正在加载更多...", "Loading more...") : t("查看更多", "View More")}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

function formatInviteState(state: "active" | "accepted" | "expired" | "revoked", language: AppLanguage) {
  const labels = {
    active: { zh: "活跃", en: "Active" },
    accepted: { zh: "已接受", en: "Accepted" },
    expired: { zh: "已过期", en: "Expired" },
    revoked: { zh: "已撤销", en: "Revoked" },
  } satisfies Record<typeof state, Record<AppLanguage, string>>;
  return labels[state][language];
}

function formatInviteRole(role: string | null, language: AppLanguage) {
  const option = inviteRoleOptions.find((candidate) => candidate.value === role);
  return option?.label[language] ?? "—";
}
