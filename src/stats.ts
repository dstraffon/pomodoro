// Aggregations over completed focus sessions. Pure functions for easy testing.

export interface Session {
  /** Epoch ms when the session finished. */
  at: number;
  minutes: number;
  taskId?: string;
}

export function dayKey(t: number | Date): string {
  const d = new Date(t);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function startOfDay(t: number): Date {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function minutesByDay(sessions: Session[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of sessions) map.set(dayKey(s.at), (map.get(dayKey(s.at)) ?? 0) + s.minutes);
  return map;
}

export function sessionsOn(sessions: Session[], now: number): Session[] {
  const key = dayKey(now);
  return sessions.filter((s) => dayKey(s.at) === key);
}

/**
 * Consecutive days with at least one session, ending today. If today has no
 * sessions yet the streak still counts from yesterday, so it isn't "lost"
 * until the day is actually over.
 */
export function streak(sessions: Session[], now: number): number {
  const days = new Set(sessions.map((s) => dayKey(s.at)));
  let cursor = startOfDay(now);
  if (!days.has(dayKey(cursor))) cursor = addDays(cursor, -1);
  let count = 0;
  while (days.has(dayKey(cursor))) {
    count++;
    cursor = addDays(cursor, -1);
  }
  return count;
}

export interface HeatCell {
  key: string;
  minutes: number;
  /** 0–4 intensity bucket. */
  level: number;
  future: boolean;
}

/** Calendar grid of `weeks` columns × 7 rows (Mon–Sun), ending with the current week. */
export function heatmap(sessions: Session[], now: number, weeks = 12): HeatCell[][] {
  const byDay = minutesByDay(sessions);
  const today = startOfDay(now);
  const mondayOffset = (today.getDay() + 6) % 7;
  const firstMonday = addDays(today, -mondayOffset - (weeks - 1) * 7);
  const cols: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(firstMonday, w * 7 + d);
      const key = dayKey(date);
      const minutes = byDay.get(key) ?? 0;
      const level = minutes === 0 ? 0 : minutes < 30 ? 1 : minutes < 60 ? 2 : minutes < 120 ? 3 : 4;
      col.push({ key, minutes, level, future: date > today });
    }
    cols.push(col);
  }
  return cols;
}

/** Focus minutes for each of the last 7 days, oldest first. */
export function lastWeek(sessions: Session[], now: number): { key: string; label: string; minutes: number }[] {
  const byDay = minutesByDay(sessions);
  const today = startOfDay(now);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i - 6);
    const key = dayKey(date);
    return {
      key,
      label: date.toLocaleDateString(undefined, { weekday: 'narrow' }),
      minutes: byDay.get(key) ?? 0,
    };
  });
}
