const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function fmtClock(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function fmtDateLabel(d: Date): string {
  return `${WEEKDAYS[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}

export function fmtSpawnAt(d: Date, today: Date): string {
  const sameDay = d.toDateString() === today.toDateString();
  const dayLabel = sameDay ? "hoje" : "amanhã";
  return `${dayLabel} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtEta(ms: number): string | null {
  if (ms <= 0) return null;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export type Status = { cls: "urgent" | "soon" | "safe"; label: string };

export function statusFor(ms: number): Status {
  if (ms <= 0) return { cls: "safe", label: "disponível" };
  if (ms <= 60 * 60 * 1000) return { cls: "urgent", label: "em breve" };
  if (ms <= 3 * 60 * 60 * 1000) return { cls: "soon", label: "aproximando" };
  return { cls: "safe", label: "programado" };
}

/**
 * Parses a respawn time input into total minutes, or null if invalid.
 *  - "3:11" or "3h11"  -> 3h11min (191 minutes)
 *  - "45"              -> 45 minutes (a bare number is always minutes)
 */
export function parseDurationToMinutes(input: string): number | null {
  const str = input.trim().replace(",", ".");
  if (!str) return null;

  const withColon = str.match(/^(\d{1,3})\s*[:h]\s*(\d{1,2})?$/i);
  if (withColon) {
    const h = parseInt(withColon[1], 10);
    const min = withColon[2] ? parseInt(withColon[2], 10) : 0;
    if (min > 59) return null;
    return h * 60 + min;
  }

  const bareNumber = str.match(/^(\d{1,4})$/);
  if (bareNumber) {
    return parseInt(bareNumber[1], 10);
  }

  return null;
}
