import { useState } from "react";
import type { Agent } from "@paperclipai/shared";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { User } from "lucide-react";
import { cn } from "../lib/utils";
import { AgentIcon } from "./AgentIconPicker";
import { useLanguage } from "../context/LanguageContext";

const stableRoleLabels: Record<string, string> = {
  ceo: "CEO",
  cto: "CTO",
  cmo: "CMO",
  cfo: "CFO",
};

export function ReportsToPicker({
  agents,
  value,
  onChange,
  disabled = false,
  excludeAgentIds = [],
  disabledEmptyLabel,
  chooseLabel,
}: {
  agents: Agent[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  excludeAgentIds?: string[];
  disabledEmptyLabel?: string;
  chooseLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useLanguage();
  const exclude = new Set(excludeAgentIds);
  const rows = agents.filter(
    (a) => a.status !== "terminated" && !exclude.has(a.id),
  );
  const current = value ? agents.find((a) => a.id === value) : null;
  const terminatedManager = current?.status === "terminated";
  const unknownManager = Boolean(value && !current);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex max-w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-md border border-border px-2 py-1 text-xs hover:bg-accent/50 transition-colors",
            terminatedManager && "border-amber-600/45 bg-amber-500/5",
            disabled && "opacity-60 cursor-not-allowed",
          )}
          disabled={disabled}
        >
          {unknownManager ? (
            <>
              <User className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate text-muted-foreground">{t("agent.reports.unknown")}</span>
            </>
          ) : current ? (
            <>
              <AgentIcon icon={current.icon} className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span
                className={cn(
                  "min-w-0 truncate",
                  terminatedManager && "text-amber-900 dark:text-amber-200",
                )}
              >
                {t("agent.reports.manager", {
                  name: current.name,
                  suffix: terminatedManager ? t("agent.reports.terminatedSuffix") : "",
                })}
              </span>
            </>
          ) : (
            <>
              <User className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">
                {disabled
                  ? (disabledEmptyLabel ?? t("agent.reports.disabledCeo"))
                  : (chooseLabel ?? t("agent.reports.choose"))}
              </span>
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="start">
        <button
          type="button"
          className={cn(
            "flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50",
            value === null && "bg-accent",
          )}
          onClick={() => {
            onChange(null);
            setOpen(false);
          }}
        >
          {t("agent.reports.noManager")}
        </button>
        {terminatedManager && (
          <div className="flex min-w-0 items-center gap-2 overflow-hidden px-2 py-1.5 text-xs text-muted-foreground border-b border-border mb-0.5">
            <AgentIcon icon={current.icon} className="shrink-0 h-3 w-3" />
            <span className="min-w-0 truncate">
              {t("agent.reports.currentTerminated", { name: current.name })}
            </span>
          </div>
        )}
        {unknownManager && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground border-b border-border mb-0.5">
            {t("agent.reports.missing")}
          </div>
        )}
        {rows.map((a) => (
          <button
            type="button"
            key={a.id}
            className={cn(
              "flex items-center gap-2 w-full min-w-0 px-2 py-1.5 text-xs rounded hover:bg-accent/50 overflow-hidden",
              a.id === value && "bg-accent",
            )}
            onClick={() => {
              onChange(a.id);
              setOpen(false);
            }}
          >
            <AgentIcon icon={a.icon} className="shrink-0 h-3 w-3 text-muted-foreground" />
            <span className="min-w-0 truncate">{a.name}</span>
            <span className="text-muted-foreground ml-auto shrink-0">{stableRoleLabels[a.role] ?? t(`agent.role.${a.role}`)}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
