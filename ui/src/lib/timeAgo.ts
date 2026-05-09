import { translateText, type AppLanguage } from "../context/LanguageContext";

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

export function timeAgo(date: Date | string, language: AppLanguage = "en"): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const seconds = Math.round((now - then) / 1000);

  if (seconds < MINUTE) return translateText(language, "time.justNow");
  if (seconds < HOUR) {
    const m = Math.floor(seconds / MINUTE);
    return translateText(language, "time.minutesAgo", { count: m });
  }
  if (seconds < DAY) {
    const h = Math.floor(seconds / HOUR);
    return translateText(language, "time.hoursAgo", { count: h });
  }
  if (seconds < WEEK) {
    const d = Math.floor(seconds / DAY);
    return translateText(language, "time.daysAgo", { count: d });
  }
  if (seconds < MONTH) {
    const w = Math.floor(seconds / WEEK);
    return translateText(language, "time.weeksAgo", { count: w });
  }
  const mo = Math.floor(seconds / MONTH);
  return translateText(language, "time.monthsAgo", { count: mo });
}
