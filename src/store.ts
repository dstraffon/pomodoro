// Tiny persisted state layer. Everything lives in localStorage; failures
// (private mode, quota) fall back to in-memory defaults.

import type { Durations, TimerState } from './timer';
import type { Session } from './stats';

export type Sound = 'off' | 'rain' | 'brown' | 'waves' | 'drone';

export interface Settings extends Durations {
  autoStartBreaks: boolean;
  autoStartFocus: boolean;
  dailyGoal: number;
  volume: number;
  sound: Sound;
  chime: boolean;
  notify: boolean;
  tick: boolean;
}

export interface Task {
  id: string;
  title: string;
  estimate: number;
  done: number;
  completed: boolean;
}

export interface AppData {
  settings: Settings;
  tasks: Task[];
  activeTaskId: string | null;
  sessions: Session[];
  timer: TimerState | null;
}

export const DEFAULT_SETTINGS: Settings = {
  focusMin: 25,
  shortMin: 5,
  longMin: 15,
  longEvery: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
  dailyGoal: 8,
  volume: 0.5,
  sound: 'off',
  chime: true,
  notify: false,
  tick: false,
};

const KEY = 'ember.pomodoro.v1';

export function load(): AppData {
  const fallback: AppData = {
    settings: { ...DEFAULT_SETTINGS },
    tasks: [],
    activeTaskId: null,
    sessions: [],
    timer: null,
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<AppData>;
    return {
      ...fallback,
      ...parsed,
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
    };
  } catch {
    return fallback;
  }
}

let saveQueued = false;
export function save(data: AppData): void {
  if (saveQueued) return;
  saveQueued = true;
  queueMicrotask(() => {
    saveQueued = false;
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* storage unavailable: keep running in memory */
    }
  });
}

export const uid = () => Math.random().toString(36).slice(2, 10);
