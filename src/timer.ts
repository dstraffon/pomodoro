// Pure timer state machine. Time is always derived from wall-clock timestamps,
// so the countdown stays accurate when the tab is throttled or backgrounded.

export type Mode = 'focus' | 'short' | 'long';
export type Status = 'idle' | 'running' | 'paused';

export interface Durations {
  focusMin: number;
  shortMin: number;
  longMin: number;
  longEvery: number;
}

export interface TimerState {
  mode: Mode;
  status: Status;
  durationMs: number;
  /** Epoch ms the session ends at; only set while running. */
  endsAt: number | null;
  /** Remaining time while idle or paused. */
  remainingMs: number;
  /** Focus sessions completed in the current cycle (resets after a long break). */
  cycleCount: number;
}

const MIN = 60_000;

export function durationFor(mode: Mode, d: Durations): number {
  const min = mode === 'focus' ? d.focusMin : mode === 'short' ? d.shortMin : d.longMin;
  return Math.max(1, Math.round(min * 60)) * 1000;
}

export function createTimer(d: Durations, mode: Mode = 'focus', cycleCount = 0): TimerState {
  const durationMs = durationFor(mode, d);
  return { mode, status: 'idle', durationMs, endsAt: null, remainingMs: durationMs, cycleCount };
}

export function remaining(s: TimerState, now: number): number {
  if (s.status === 'running' && s.endsAt !== null) return Math.max(0, s.endsAt - now);
  return s.remainingMs;
}

export function progress(s: TimerState, now: number): number {
  return s.durationMs === 0 ? 1 : 1 - remaining(s, now) / s.durationMs;
}

export function start(s: TimerState, now: number): TimerState {
  if (s.status === 'running') return s;
  return { ...s, status: 'running', endsAt: now + s.remainingMs };
}

export function pause(s: TimerState, now: number): TimerState {
  if (s.status !== 'running') return s;
  return { ...s, status: 'paused', endsAt: null, remainingMs: remaining(s, now) };
}

export function toggle(s: TimerState, now: number): TimerState {
  return s.status === 'running' ? pause(s, now) : start(s, now);
}

export function reset(s: TimerState, d: Durations): TimerState {
  return createTimer(d, s.mode, s.cycleCount);
}

export function switchMode(s: TimerState, mode: Mode, d: Durations): TimerState {
  return createTimer(d, mode, s.cycleCount);
}

/** Which mode follows the current one, given the cycle count *after* completion. */
export function nextMode(mode: Mode, cycleCount: number, d: Durations): Mode {
  if (mode !== 'focus') return 'focus';
  return cycleCount > 0 && cycleCount % Math.max(1, d.longEvery) === 0 ? 'long' : 'short';
}

/**
 * Advance to the next session. `completed` is false when the user skips,
 * in which case a skipped focus session doesn't count toward the cycle.
 */
export function advance(s: TimerState, d: Durations, completed: boolean): TimerState {
  let cycle = s.cycleCount;
  if (s.mode === 'focus' && completed) cycle += 1;
  const mode = nextMode(s.mode, cycle, d);
  if (s.mode === 'long') cycle = 0;
  return createTimer(d, mode, cycle);
}

/** Returns true when a running session has reached zero. */
export function isDone(s: TimerState, now: number): boolean {
  return s.status === 'running' && remaining(s, now) <= 0;
}

export function format(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export const minutes = (ms: number) => Math.round(ms / MIN);
