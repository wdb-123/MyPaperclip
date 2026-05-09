import { cn } from "../lib/utils";
import { statusBadge, statusBadgeDefault } from "../lib/status-colors";
import { useLanguage } from "../context/LanguageContext";

export function StatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const translated = t(`status.${status}`);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0",
        statusBadge[status] ?? statusBadgeDefault
      )}
    >
      {translated === `status.${status}` ? status.replace(/_/g, " ") : translated}
    </span>
  );
}
