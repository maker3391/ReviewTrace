import type { Locale } from "@/config/i18n";
import {
  formatCompactDateTime,
  formatExactDateTime,
  formatRelativeTime,
} from "@/lib/format/date";

export function Timestamp({
  value,
  variant,
  now,
  locale = "ko",
  className,
}: {
  value: Date | null;
  variant: "exact" | "compact" | "relative";
  now?: Date;
  locale?: Locale;
  className?: string;
}) {
  if (value === null || Number.isNaN(value.getTime())) {
    return <span className={className}>—</span>;
  }

  const exact = formatExactDateTime(value);
  const display =
    variant === "exact"
      ? exact
      : variant === "compact"
        ? formatCompactDateTime(value)
        : formatRelativeTime(value, now ?? value, locale);

  return (
    <time
      dateTime={value.toISOString()}
      title={exact}
      aria-label={exact}
      className={className}
    >
      {display}
    </time>
  );
}
