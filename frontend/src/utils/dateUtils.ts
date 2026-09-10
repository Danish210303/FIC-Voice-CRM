/**
 * Timezone-Safe Date and Time Utilities for Indian Standard Time (IST / Asia/Kolkata / UTC+05:30).
 * Displays times consistently as: "09 Sept 2026, 11:07 AM IST".
 */

export const IST_TIMEZONE = "Asia/Kolkata";

/**
 * Parses any ISO or standard datetime string into a safe Date object.
 * If the string comes from backend UTC storage without timezone, treats it as UTC.
 */
export function parseToDate(input: string | Date | undefined | null): Date | null {
  if (!input) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;

  let s = String(input).trim();
  if (!s) return null;

  // Handle YYYY-MM-DD HH:MM / YYYY-MM-DDTHH:MM without trailing Z/offset
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) {
    s = s.replace(" ", "T");
    if (!s.endsWith("Z") && !s.includes("+")) {
      s = `${s}Z`;
    }
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Formats any datetime to standard Indian Tamil Nadu IST string:
 * e.g., "09 Sept 2026, 11:07 AM IST"
 */
export function formatISTDateTime(input: string | Date | undefined | null): string {
  if (!input) return "Not set";
  const date = parseToDate(input);
  if (!date) return String(input);

  try {
    const formatter = new Intl.DateTimeFormat("en-IN", {
      timeZone: IST_TIMEZONE,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    const parts = formatter.formatToParts(date);
    const day = parts.find((p) => p.type === "day")?.value || "";
    let month = parts.find((p) => p.type === "month")?.value || "";
    if (month.toLowerCase() === "sep") month = "Sept";
    const year = parts.find((p) => p.type === "year")?.value || "";
    const hour = parts.find((p) => p.type === "hour")?.value || "";
    const minute = parts.find((p) => p.type === "minute")?.value || "";
    const dayPeriod = (parts.find((p) => p.type === "dayPeriod")?.value || "AM").toUpperCase();

    return `${day} ${month} ${year}, ${hour}:${minute} ${dayPeriod} IST`;
  } catch {
    return date.toLocaleString("en-IN", { timeZone: IST_TIMEZONE });
  }
}

/**
 * Returns formatted two-line IST parts: { date: "09 Sept 2026", time: "04:37 PM IST" }
 */
export function formatISTDateParts(input: string | Date | undefined | null): { date: string; time: string } {
  if (!input) return { date: "Not set", time: "" };
  const date = parseToDate(input);
  if (!date) return { date: String(input), time: "" };

  try {
    const formatter = new Intl.DateTimeFormat("en-IN", {
      timeZone: IST_TIMEZONE,
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    const parts = formatter.formatToParts(date);
    const day = parts.find((p) => p.type === "day")?.value || "";
    let month = parts.find((p) => p.type === "month")?.value || "";
    if (month.toLowerCase() === "sep") month = "Sept";
    const year = parts.find((p) => p.type === "year")?.value || "";
    const hour = parts.find((p) => p.type === "hour")?.value || "";
    const minute = parts.find((p) => p.type === "minute")?.value || "";
    const dayPeriod = (parts.find((p) => p.type === "dayPeriod")?.value || "AM").toUpperCase();

    return {
      date: `${day} ${month} ${year}`,
      time: `${hour}:${minute} ${dayPeriod} IST`,
    };
  } catch {
    return {
      date: date.toLocaleDateString("en-IN", { timeZone: IST_TIMEZONE }),
      time: date.toLocaleTimeString("en-IN", { timeZone: IST_TIMEZONE }),
    };
  }
}

/**
 * Gets Date and Time in IST as strings for HTML date/time inputs:
 * e.g., date: "2026-09-09", time: "17:15"
 * Accepts optional offset in minutes from now.
 */
export function getCurrentISTInputs(offsetMinutes: number = 0): { date: string; time: string; combined: string } {
  const target = new Date(Date.now() + offsetMinutes * 60 * 1000);
  
  // Format as YYYY-MM-DD and HH:mm in Asia/Kolkata timezone
  const dateStr = target.toLocaleDateString("en-CA", { timeZone: IST_TIMEZONE }); // YYYY-MM-DD
  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(target);

  return {
    date: dateStr,
    time: timeParts,
    combined: `${dateStr} ${timeParts}`,
  };
}
