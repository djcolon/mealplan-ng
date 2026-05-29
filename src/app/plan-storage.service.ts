import { Injectable } from '@angular/core';

import { PlanEntry } from './models';

/** localStorage key for the persisted plan. */
const PLAN_KEY = 'mealplan-plan';

/**
 * Shape of the data written to localStorage.
 *
 * `Date` objects are not JSON-serialisable, so `dates` is stored as an
 * array of ISO 8601 strings and converted back to `Date` instances on
 * load.
 */
interface StoredPlan {
  startDate: string;
  endDate: string;
  entries: Array<Omit<PlanEntry, 'dates'> & { dates: string[] }>;
}

/**
 * Persists the current meal plan to localStorage so that it survives
 * page reloads and navigation away from the plan route.
 *
 * All localStorage access is wrapped in try/catch to handle
 * environments where the API is unavailable (e.g. private-browsing
 * quota limits, or server-side rendering during tests).
 */
@Injectable({ providedIn: 'root' })
export class PlanStorageService {
  /**
   * Serialises the active plan and writes it to localStorage.
   *
   * @param entries   - Current plan entries to persist.
   * @param startDate - ISO date string from the start-date picker.
   * @param endDate   - ISO date string from the end-date picker.
   */
  save(
    entries: PlanEntry[],
    startDate: string,
    endDate: string,
  ): void {
    const stored: StoredPlan = {
      startDate,
      endDate,
      // Convert Date objects to ISO strings for JSON serialisation
      entries: entries.map((e) => ({
        ...e,
        dates: e.dates.map((d) => d.toISOString()),
      })),
    };
    try {
      localStorage.setItem(PLAN_KEY, JSON.stringify(stored));
    } catch (err) {
      // Silently ignore write failures (e.g. storage quota exceeded)
      console.warn(
        'PlanStorageService: could not save plan to localStorage.',
        err,
      );
    }
  }

  /**
   * Reads and deserialises a previously saved plan from localStorage.
   *
   * @returns The stored plan, or `null` when none exists or the data
   *   is corrupt / unreadable.
   */
  load(): {
    entries: PlanEntry[];
    startDate: string;
    endDate: string;
  } | null {
    try {
      const raw = localStorage.getItem(PLAN_KEY);
      if (!raw) return null;

      const stored = JSON.parse(raw) as StoredPlan;

      // Revive ISO-string dates back into Date objects
      const entries: PlanEntry[] = stored.entries.map((e) => ({
        ...e,
        dates: e.dates.map((d) => new Date(d)),
      }));

      return { entries, startDate: stored.startDate, endDate: stored.endDate };
    } catch (err) {
      console.warn(
        'PlanStorageService: could not restore plan from localStorage.',
        err,
      );
      return null;
    }
  }

  /** Removes the saved plan from localStorage. */
  clear(): void {
    try {
      localStorage.removeItem(PLAN_KEY);
    } catch {
      // Ignore — nothing meaningful to do if removal fails
    }
  }
}
