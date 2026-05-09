import { useEffect } from "react";
import { ArrowLeft, RadioTower } from "lucide-react";
import { Link } from "@/lib/router";
import { ActiveAgentsPanel } from "../components/ActiveAgentsPanel";
import { EmptyState } from "../components/EmptyState";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useLanguage } from "../context/LanguageContext";

const DASHBOARD_LIVE_RUN_LIMIT = 50;

export function DashboardLive() {
  const { selectedCompanyId, companies } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { t } = useLanguage();

  useEffect(() => {
    setBreadcrumbs([
      { label: t("仪表盘", "Dashboard"), href: "/dashboard" },
      { label: t("实时运行", "Live Runs") },
    ]);
  }, [setBreadcrumbs, t]);

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={RadioTower}
        message={companies.length === 0
          ? t("创建公司后查看实时运行。", "Create a company to view live runs.")
          : t("请选择公司以查看实时运行。", "Select a company to view live runs.")}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("仪表盘", "Dashboard")}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal text-foreground">{t("代理实时运行", "Agent Live Runs")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("优先显示活跃运行，随后显示最近完成的运行。", "Active runs appear first, followed by recently completed runs.")}
          </p>
        </div>
        <div className="text-sm text-muted-foreground">
          {t("最多显示 {count} 条", "Showing up to {count}", { count: DASHBOARD_LIVE_RUN_LIMIT })}
        </div>
      </div>

      <ActiveAgentsPanel
        companyId={selectedCompanyId}
        title={t("活跃 / 最近", "Active / Recent")}
        minRunCount={DASHBOARD_LIVE_RUN_LIMIT}
        fetchLimit={DASHBOARD_LIVE_RUN_LIMIT}
        cardLimit={DASHBOARD_LIVE_RUN_LIMIT}
        gridClassName="gap-3 md:grid-cols-2 2xl:grid-cols-3"
        cardClassName="h-[420px]"
        emptyMessage={t("没有活跃或最近的代理运行。", "No active or recent agent runs.")}
        queryScope="dashboard-live"
        showMoreLink={false}
      />
    </div>
  );
}
