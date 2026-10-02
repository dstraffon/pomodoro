import { describe, expect, it } from 'vitest';
import { dayKey, heatmap, lastWeek, streak, type Session } from './stats';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
const sess = (t: number, minutes = 25): Session => ({ at: t, minutes });

describe('stats', () => {
  const now = at(2026, 10, 2, 15);

  it('counts a streak ending today', () => {
    const s = [sess(at(2026, 9, 30)), sess(at(2026, 10, 1)), sess(at(2026, 10, 2))];
    expect(streak(s, now)).toBe(3);
  });

  it('keeps yesterday’s streak alive before today’s first session', () => {
    const s = [sess(at(2026, 9, 30)), sess(at(2026, 10, 1))];
    expect(streak(s, now)).toBe(2);
  });

  it('breaks the streak on a missed day', () => {
    const s = [sess(at(2026, 9, 29)), sess(at(2026, 10, 2))];
    expect(streak(s, now)).toBe(1);
  });

  it('builds a Monday-first heatmap ending in the current week', () => {
    const grid = heatmap([sess(now, 130)], now, 12);
    expect(grid).toHaveLength(12);
    const lastCol = grid[11];
    expect(new Date(lastCol[0].key + 'T00:00').getDay()).toBe(1);
    const today = lastCol.find((c) => c.key === dayKey(now))!;
    expect(today.level).toBe(4);
    expect(lastCol.filter((c) => c.future).length).toBe(2); // Fri 2 Oct → Sat, Sun ahead
  });

  it('sums the last 7 days, oldest first', () => {
    const w = lastWeek([sess(now), sess(now), sess(at(2026, 9, 26))], now);
    expect(w).toHaveLength(7);
    expect(w[6].minutes).toBe(50);
    expect(w[0].minutes).toBe(25);
  });
});
