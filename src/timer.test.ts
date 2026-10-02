import { describe, expect, it } from 'vitest';
import * as T from './timer';

const d: T.Durations = { focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4 };

describe('timer', () => {
  it('counts down from wall-clock time and pauses exactly', () => {
    let s = T.start(T.createTimer(d), 0);
    expect(T.remaining(s, 60_000)).toBe(24 * 60_000);
    s = T.pause(s, 60_000);
    expect(T.remaining(s, 10 * 60_000)).toBe(24 * 60_000);
    s = T.start(s, 10 * 60_000);
    expect(T.remaining(s, 11 * 60_000)).toBe(23 * 60_000);
  });

  it('is done only once a running session reaches zero', () => {
    const s = T.start(T.createTimer(d), 0);
    expect(T.isDone(s, 25 * 60_000 - 1)).toBe(false);
    expect(T.isDone(s, 25 * 60_000)).toBe(true);
    expect(T.isDone(T.createTimer(d), 1e12)).toBe(false);
  });

  it('cycles focus → short ×3 → long, then resets the cycle', () => {
    let s = T.createTimer(d);
    const seen: T.Mode[] = [];
    for (let i = 0; i < 9; i++) {
      s = T.advance(s, d, true);
      seen.push(s.mode);
    }
    expect(seen).toEqual(['short', 'focus', 'short', 'focus', 'short', 'focus', 'long', 'focus', 'short']);
  });

  it('does not count a skipped focus session toward the cycle', () => {
    const s = T.advance(T.createTimer(d), d, false);
    expect(s.mode).toBe('short');
    expect(s.cycleCount).toBe(0);
  });

  it('formats mm:ss, rounding partial seconds up', () => {
    expect(T.format(25 * 60_000)).toBe('25:00');
    expect(T.format(59_001)).toBe('01:00');
    expect(T.format(0)).toBe('00:00');
  });
});
