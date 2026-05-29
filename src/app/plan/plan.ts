import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { forkJoin } from 'rxjs';

import { DataService } from '../data.service';
import { IngredientDefinition, Meal, PlanEntry } from '../models';

// ── Date utilities ────────────────────────────────────────────────────────

/**
 * Serialises a local Date to the "YYYY-MM-DD" string expected by
 * `<input type="date">` without UTC-offset shifting.
 */
function toInputDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  );
}

/**
 * Parses a "YYYY-MM-DD" string from `<input type="date">` to a Date
 * at local midnight, avoiding UTC-offset issues that arise from the
 * native `new Date(string)` constructor.
 */
function fromInputDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Returns a new Date that is `n` days after `d`. */
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/**
 * Zero-pads a number to two digits.
 */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Formats a Date as a full day label using MM/DD/YYYY.
 * Example: "Monday, 06/01/2026"
 */
function longDay(d: Date): string {
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const yyyy = d.getFullYear();
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
  return `${weekday}, ${mm}/${dd}/${yyyy}`;
}

/**
 * Formats a Date as MM/DD for use in compact date-range strings.
 * Example: "06/01"
 */
function shortDay(d: Date): string {
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
}

// ── Component ─────────────────────────────────────────────────────────────

/**
 * Generates and displays a randomly selected meal plan for a
 * configurable date range.
 *
 * Features:
 * - Start/end date pickers (defaults: tomorrow through tomorrow + 6).
 * - Random plan generation; meals tagged 'leftovers' span two days.
 * - Expandable cards showing a meal's ingredients and units.
 * - Per-card random replacement or manual picker with in-plan
 *   greying-out.
 * - For leftovers cards: checkbox to swap with another leftovers meal
 *   or split into two single-day meals.
 */
@Component({
  selector: 'app-plan',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './plan.html',
  styles: [
    `
      /* ── Calendar grid ──────────────────────────────────── */
      /*
       * Two-column grid: fixed-width date-label column on the left,
       * flexible card column on the right.  Each day is a row; the
       * grid auto-sizes rows to fit content so expanded cards grow
       * naturally and pull leftover entries with them.
       */
      .calendar-grid {
        display: grid;
        grid-template-columns: 5rem 1fr;
        grid-auto-rows: auto;
        row-gap: 0.75rem;
        column-gap: 0.75rem;
        align-items: stretch;
      }

      /* Date label in the left column (both single and leftover days) */
      .day-header {
        grid-column: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.1rem;
        padding: 0.5rem 0.25rem;
        background-color: #f8f9fa;
        border: 1px solid rgba(0, 0, 0, 0.125);
        border-radius: 0.375rem;
        text-align: center;
      }
      .day-header .day-name {
        display: block;
        font-size: 0.7rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #6c757d;
      }
      .day-header .day-date {
        display: block;
        font-size: 0.95rem;
        font-weight: 700;
        color: #212529;
      }

      /*
       * For leftover entries the date label spans 2 rows.
       * Show both days separated by a thin horizontal rule.
       */
      .day-header--leftover {
        flex-direction: column;
        justify-content: space-evenly;
      }
      .day-header--leftover .day-divider {
        width: 70%;
        border: none;
        border-top: 1px solid rgba(0, 0, 0, 0.15);
        margin: 0.25rem 0;
      }

      /* Meal cards always sit in the right column. */
      .meal-card {
        grid-column: 2;
        min-width: 0;
        /* Needed so ::before / ::after drop-indicator lines are
           positioned relative to the card, not the page. */
        position: relative;
      }

      /* ── Drag handle ─────────────────────────────────────── */
      /* Six-dot braille glyph used as a standard drag handle. */
      .drag-handle {
        cursor: grab;
        padding: 0 0.5rem 0 0;
        color: #adb5bd;
        user-select: none;
        flex-shrink: 0;
        font-size: 1.1rem;
        line-height: 1;
        /* prevent touch devices scrolling instead of dragging */
        touch-action: none;
      }
      .drag-handle:hover  { color: #6c757d; }
      .drag-handle:active { cursor: grabbing; }

      /* Dragged card fades in place so the user can see the gap. */
      .is-dragging { opacity: 0.25; }

      /* ── Drop indicator line ─────────────────────────────── */
      /*
       * A 3 px blue line rendered via ::before (before a card) or
       * ::after (after the last card).  The negative left value
       * extends the line over the day-header column so it spans
       * the full grid width.
       */
      .drop-before::before,
      .drop-after::after {
        content: '';
        position: absolute;
        /* span left over: day-header (5rem) + column-gap (0.75rem) */
        left: calc(-5rem - 0.75rem);
        right: 0;
        height: 3px;
        background: #0d6efd;
        border-radius: 2px;
        z-index: 10;
        pointer-events: none;
      }
      /* Centre the line in the 0.75rem row-gap (half = 0.375rem) */
      .drop-before::before { top:    calc(-0.375rem - 1.5px); }
      .drop-after::after   { bottom: calc(-0.375rem - 1.5px); }

      /* ── Flash animation ─────────────────────────────────── */
      @keyframes meal-flash {
        0%   {
          box-shadow: 0 0 0 3px #ffc107;
          background-color: #fff9e6;
        }
        60%  {
          box-shadow: 0 0 0 3px #ffc107;
          background-color: #fff9e6;
        }
        100% {
          box-shadow: none;
          background-color: transparent;
        }
      }
      .meal-changed {
        animation: meal-flash 0.8s ease-out;
      }
    `,
  ],
})
export class PlanComponent implements OnInit {
  private readonly dataService = inject(DataService);

  // ── Data ──────────────────────────────────────────────────────────────

  /** All meals loaded from meals.yaml; also used in the picker modal */
  readonly allMeals = signal<Meal[]>([]);

  /**
   * Ingredient name → unit string map, built from ingredients.yaml.
   * An absent entry means the ingredient is measured individually.
   */
  private readonly unitMap = signal<Map<string, string | undefined>>(
    new Map(),
  );

  /** True while the initial data fetch is in progress */
  readonly loading = signal(true);

  /** Human-readable error message shown when data loading fails */
  readonly error = signal<string | null>(null);

  // ── Date range ────────────────────────────────────────────────────────

  /** ISO date bound to the "From" date input (default: tomorrow) */
  readonly startDate = signal(toInputDate(addDays(new Date(), 1)));

  /**
   * ISO date bound to the "To" date input.
   * Default: 6 days after the start, giving a 7-day plan.
   */
  readonly endDate = signal(toInputDate(addDays(new Date(), 7)));

  // ── Plan state ────────────────────────────────────────────────────────

  /**
   * The active plan.
   * Each entry covers 1 day (regular meal) or 2 days (leftovers meal).
   */
  readonly planEntries = signal<PlanEntry[]>([]);

  /**
   * Index of the plan entry that is currently playing its change
   * animation, or null when no animation is running.
   */
  readonly changedIndex = signal<number | null>(null);

  /** Index of the entry being dragged, or null when not dragging. */
  readonly dragIndex = signal<number | null>(null);

  /**
   * The insertion slot that would receive the dragged entry on drop.
   * Slot 0 = before entry 0; slot N = after the last entry.
   * null when no drag is in progress or the cursor left the grid.
   */
  readonly dropSlot = signal<number | null>(null);

  /**
   * The 1-based grid-row start position for each plan entry.
   * Cumulative: a leftover entry (2 dates) advances the counter by
   * 2, so the next entry starts two rows further down.
   */
  readonly entryRowStart = computed<number[]>(() => {
    let row = 1;
    return this.planEntries().map((e) => {
      const start = row;
      row += e.dates.length;
      return start;
    });
  });

  /**
   * Total number of days covered by the current plan.
   * Drives the CSS custom property that sets the grid row count.
   */
  readonly numPlanDays = computed<number>(() =>
    this.planEntries().reduce((sum, e) => sum + e.dates.length, 0),
  );

  // ── Picker modal state ────────────────────────────────────────────────

  /**
   * Index into `planEntries` of the entry being replaced, or null
   * when the picker is closed.
   */
  readonly pickerEntryIndex = signal<number | null>(null);

  /** True while the picker modal is open */
  readonly pickerOpen = computed(() => this.pickerEntryIndex() !== null);

  /** The plan entry currently targeted by the picker */
  readonly pickerEntry = computed<PlanEntry | null>(() => {
    const i = this.pickerEntryIndex();
    return i !== null ? this.planEntries()[i] : null;
  });

  /**
   * True when the picker is open for a two-day (leftovers) entry.
   * Controls visibility of the replacement-mode checkbox in the modal.
   */
  readonly isPickerForLeftovers = computed(
    () => (this.pickerEntry()?.dates.length ?? 0) > 1,
  );

  /**
   * Whether the picker is in "replace with leftover" mode.
   * When true, only leftovers meals are selectable.
   * When false, only single meals are selectable (split mode).
   * Initialised from the targeted entry's `replaceWithLeftover` flag
   * each time the picker opens.
   */
  readonly pickerLeftover = signal(true);

  /**
   * Set of meal titles already in the plan, excluding the entry
   * currently being replaced. Used in the picker to grey-out "in use"
   * meals without including the current entry's own meal.
   */
  readonly pickerMealsInPlan = computed(
    () =>
      new Set(
        this.planEntries()
          .filter((_, idx) => idx !== this.pickerEntryIndex())
          .map((e) => e.meal.title),
      ),
  );

  // ── Lifecycle ─────────────────────────────────────────────────────────

  ngOnInit(): void {
    // Load meals and ingredients in parallel; both are needed before
    // the page can render unit-annotated ingredients.
    forkJoin({
      meals: this.dataService.getMeals(),
      ingredients: this.dataService.getIngredients(),
    }).subscribe({
      next: ({ meals, ingredients }) => {
        this.allMeals.set(meals);
        this.unitMap.set(
          new Map(
            ingredients.map(
              (ing: IngredientDefinition) => [ing.name, ing.unit],
            ),
          ),
        );
        this.loading.set(false);
      },
      error: (err: unknown) => {
        const message =
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred.';
        console.error('PlanComponent: failed to load data', err);
        this.error.set(
          `Could not load data. Please refresh the page. (${message})`,
        );
        this.loading.set(false);
      },
    });
  }

  // ── Template helpers ──────────────────────────────────────────────────

  /**
   * Returns the measurement unit for a named ingredient, or undefined
   * when it is counted individually (e.g. "each").
   */
  unitFor(name: string): string | undefined {
    return this.unitMap().get(name);
  }

  /**
   * Returns the abbreviated weekday name for a date.
   * Example: "Mon"
   */
  dayName(d: Date): string {
    return d.toLocaleDateString('en-US', { weekday: 'short' });
  }

  /**
   * Returns the date formatted as MM/DD.
   * Example: "06/01"
   */
  shortDate(d: Date): string {
    return shortDay(d);
  }

  /**
   * Returns a compact date-range label for the embedded header
   * inside leftover cards.
   * Example: "Mon 06/01 – Tue 06/02"
   */
  leftoverDateRange(dates: Date[]): string {
    const fmt = (d: Date) => `${this.dayName(d)} ${shortDay(d)}`;
    return `${fmt(dates[0])} \u2013 ${fmt(dates[1])}`;
  }

  /**
   * Formats the date label shown in a plan card header.
   *
   * Single-day entry → "Monday, 1 June 2026"
   * Two-day entry    → "Mon 1 Jun – Tue 2 Jun"
   */
  formatEntryDates(dates: Date[]): string {
    if (dates.length === 1) return longDay(dates[0]);
    return `${shortDay(dates[0])} – ${shortDay(dates[1])}`;
  }
  // ── Drag-and-drop ──────────────────────────────────────────────────

  /**
   * Records which entry is being dragged and sets a custom drag image
   * that shows the full card rather than just the drag handle.
   */
  onDragStart(event: DragEvent, i: number): void {
    this.dragIndex.set(i);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      // Walk up from the handle to find the enclosing card element
      // so the ghost image looks like the full meal card.
      const handle = event.target as HTMLElement;
      const card = handle.closest('.meal-card') as HTMLElement;
      if (card) {
        event.dataTransfer.setDragImage(card, 24, 24);
      }
    }
  }

  /**
   * Updates `dropSlot` as the cursor moves over entry `i`.
   * Cursor in the top half of the card → insert before card i.
   * Cursor in the bottom half               → insert after card i.
   */
  onDragOver(event: DragEvent, i: number): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    const el = event.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const slot = event.clientY < rect.top + rect.height / 2 ? i : i + 1;
    this.dropSlot.set(slot);
  }

  /**
   * Clears the drop indicator when the cursor leaves the calendar grid
   * (but not when it merely moves between children inside the grid).
   */
  onGridDragLeave(event: DragEvent): void {
    const grid = event.currentTarget as HTMLElement;
    if (!grid.contains(event.relatedTarget as Node)) {
      this.dropSlot.set(null);
    }
  }

  /** Resets drag state without committing a move. */
  onDragEnd(): void {
    this.dragIndex.set(null);
    this.dropSlot.set(null);
  }

  /**
   * Commits the drag: moves the entry from its source position to the
   * target slot, then reassigns plan dates to maintain calendar order.
   */
  onDrop(event: DragEvent): void {
    event.preventDefault();
    const from = this.dragIndex();
    const to = this.dropSlot();
    // Skip no-op drops (dropping before/after the entry itself)
    if (
      from !== null &&
      to !== null &&
      to !== from &&
      to !== from + 1
    ) {
      this.reorderEntries(from, to);
    }
    this.dragIndex.set(null);
    this.dropSlot.set(null);
  }

  /**
   * Moves the plan entry at `from` into slot `to`, redistributing
   * dates so that calendar positions are preserved.
   *
   * Dates are collected in calendar order, the entries array is
   * reordered, and dates are then reassigned sequentially — so a
   * leftover entry still spans two consecutive days, just whichever
   * two days its new position covers.
   */
  private reorderEntries(from: number, to: number): void {
    // Preserve calendar dates in their original order
    const allDates = this.planEntries().flatMap((e) => e.dates);

    const entries = [...this.planEntries()];
    const [moved] = entries.splice(from, 1);
    // After splicing out the source element, indices above `from`
    // shift down by 1, so the logical insert position is to-1.
    const insertAt = to > from ? to - 1 : to;
    entries.splice(insertAt, 0, moved);

    // Redistribute dates across the reordered entries
    let dateIdx = 0;
    this.planEntries.set(
      entries.map((e) => ({
        ...e,
        dates: allDates.slice(dateIdx, (dateIdx += e.dates.length)),
      })),
    );
  }
  // ── Plan generation ───────────────────────────────────────────────────

  /**
   * Generates a fresh random plan for the currently selected date
   * range and stores it in `planEntries`.
   * Silently ignores invalid (end before start) ranges.
   */
  generatePlan(): void {
    const start = fromInputDate(this.startDate());
    const end = fromInputDate(this.endDate());
    if (end < start) return;

    const dates: Date[] = [];
    for (
      let d = new Date(start);
      d <= end;
      d = addDays(d, 1)
    ) {
      dates.push(new Date(d));
    }

    this.planEntries.set(this.buildPlan(this.allMeals(), dates));
  }

  /**
   * Assembles a randomised plan from `meals` covering the supplied
   * `dates`.
   *
   * For each unfilled day:
   * - A meal is chosen at random, preferring ones not yet in the plan.
   * - If the meal is tagged 'leftovers' AND ≥ 2 days remain, the entry
   *   spans 2 days and no separate meal is chosen for the next day.
   * - A leftovers meal on the final available day is permissible (it
   *   spans only that one day).
   */
  private buildPlan(meals: Meal[], dates: Date[]): PlanEntry[] {
    const entries: PlanEntry[] = [];
    let i = 0;

    while (i < dates.length) {
      const used = new Set(entries.map((e) => e.meal.title));
      const pool = meals.filter((m) => !used.has(m.title));
      const meal = this.pickRandom(pool.length ? pool : meals);

      const isLeftover = meal.tags?.includes('leftovers') ?? false;
      const remaining = dates.length - i;
      // Span two days only when leftovers AND a next day exists
      const span = isLeftover && remaining >= 2 ? 2 : 1;

      entries.push({
        meal,
        dates: dates.slice(i, i + span),
        expanded: false,
        replaceWithLeftover: true,
      });

      i += span;
    }

    return entries;
  }

  // ── Card interactions ─────────────────────────────────────────────────

  /** Toggles the expanded/collapsed state of the card at index `i`. */
  toggleExpanded(i: number): void {
    this.planEntries.update((es) => {
      const copy = [...es];
      copy[i] = { ...copy[i], expanded: !copy[i].expanded };
      return copy;
    });
  }

  /**
   * Sets the replacement mode for the leftovers entry at index `i`
   * and syncs the picker's checkbox if that entry's picker is open.
   *
   * @param i            - Index of the plan entry to update
   * @param withLeftover - true: replace with another leftovers meal;
   *                       false: split into two single-day meals
   */
  setReplaceMode(i: number, withLeftover: boolean): void {
    this.planEntries.update((es) => {
      const copy = [...es];
      copy[i] = { ...copy[i], replaceWithLeftover: withLeftover };
      return copy;
    });
    // Keep picker checkbox in sync if it is currently open for this entry
    if (this.pickerEntryIndex() === i) {
      this.pickerLeftover.set(withLeftover);
    }
  }

  /**
   * Replaces the entry at index `i` with a randomly chosen alternative.
   *
   * - Single-day entry → pick any meal not already in the plan.
   * - Two-day entry, replaceWithLeftover=true → pick a random leftovers
   *   meal; entry keeps its two dates.
   * - Two-day entry, replaceWithLeftover=false → split into two single-
   *   day entries, each with a random non-leftovers meal.
   */
  replaceRandom(i: number): void {
    const entries = this.planEntries();
    const entry = entries[i];
    const isLeftoverEntry = entry.dates.length > 1;

    // Titles used by all other entries (not the one being replaced)
    const used = new Set(
      entries.filter((_, idx) => idx !== i).map((e) => e.meal.title),
    );

    if (isLeftoverEntry && !entry.replaceWithLeftover) {
      this.splitIntoSingles(i, entry, used);
    } else {
      this.swapMealInPlace(i, entry, isLeftoverEntry, used);
    }

    // Flash the card at index i (first card when split into two)
    this.flashCard(i);
  }

  /**
   * Splits a two-day leftovers entry at index `i` into two single-day
   * entries, each assigned a random non-leftovers meal.
   */
  private splitIntoSingles(
    i: number,
    entry: PlanEntry,
    used: Set<string>,
  ): void {
    const singles = this.allMeals().filter(
      (m) => !(m.tags?.includes('leftovers')),
    );

    const pool1 = singles.filter((m) => !used.has(m.title));
    const meal1 = this.pickRandom(pool1.length ? pool1 : singles);
    used.add(meal1.title);

    const pool2 = singles.filter((m) => !used.has(m.title));
    const meal2 = this.pickRandom(pool2.length ? pool2 : singles);

    this.planEntries.update((es) => {
      const copy = [...es];
      copy.splice(
        i,
        1,
        {
          meal: meal1,
          dates: [entry.dates[0]],
          expanded: false,
          replaceWithLeftover: false,
        },
        {
          meal: meal2,
          dates: [entry.dates[1]],
          expanded: false,
          replaceWithLeftover: false,
        },
      );
      return copy;
    });
  }

  /**
   * Replaces the meal in an entry in-place, keeping the same dates.
   * Picks from the leftovers pool for two-day entries, or from all
   * meals for single-day entries.
   */
  private swapMealInPlace(
    i: number,
    entry: PlanEntry,
    isLeftoverEntry: boolean,
    used: Set<string>,
  ): void {
    const base = isLeftoverEntry
      ? this.allMeals().filter((m) => m.tags?.includes('leftovers'))
      : this.allMeals();

    const pool = base.filter((m) => !used.has(m.title));
    const newMeal = this.pickRandom(pool.length ? pool : base);

    this.planEntries.update((es) => {
      const copy = [...es];
      copy[i] = { ...entry, meal: newMeal };
      return copy;
    });
  }

  // ── Picker ────────────────────────────────────────────────────────────

  /** Opens the picker modal targeting the entry at index `i`. */
  openPicker(i: number): void {
    const entry = this.planEntries()[i];
    this.pickerEntryIndex.set(i);
    this.pickerLeftover.set(entry.replaceWithLeftover);
  }

  /** Closes the picker without making any selection. */
  closePicker(): void {
    this.pickerEntryIndex.set(null);
  }

  /**
   * Determines whether `meal` can be selected in the current picker
   * context.
   *
   * - Picker for a single-day entry: all meals are selectable.
   * - Picker for a two-day entry in leftover mode: only leftovers meals.
   * - Picker for a two-day entry in split mode: only single meals
   *   (so the user doesn't accidentally pick a new leftovers meal for
   *   just one of the two split days).
   */
  isPickerSelectable(meal: Meal): boolean {
    if (!this.isPickerForLeftovers()) return true;

    const isLeftoverMeal = meal.tags?.includes('leftovers') ?? false;
    // Leftover mode → must pick a leftover; split mode → must pick single
    return this.pickerLeftover() ? isLeftoverMeal : !isLeftoverMeal;
  }

  /**
   * Confirms a meal selection from the picker.
   *
   * - Single-day entry or leftover-for-leftover swap: replaces the meal
   *   in-place, keeping the same dates.
   * - Split mode (two-day entry, picker in non-leftover mode): the user
   *   picks day-1's meal; day-2 is assigned a random non-leftovers meal
   *   automatically.
   */
  confirmPick(meal: Meal): void {
    const i = this.pickerEntryIndex();
    if (i === null) return;

    const entries = this.planEntries();
    const entry = entries[i];

    if (this.isPickerForLeftovers() && !this.pickerLeftover()) {
      // Split: picked meal → day 1; random non-leftover → day 2
      const used = new Set(
        entries.filter((_, idx) => idx !== i).map((e) => e.meal.title),
      );
      used.add(meal.title);

      const singles = this.allMeals().filter(
        (m) => !(m.tags?.includes('leftovers')),
      );
      const pool2 = singles.filter((m) => !used.has(m.title));
      const meal2 = this.pickRandom(pool2.length ? pool2 : singles);

      this.planEntries.update((es) => {
        const copy = [...es];
        copy.splice(
          i,
          1,
          {
            meal,
            dates: [entry.dates[0]],
            expanded: false,
            replaceWithLeftover: false,
          },
          {
            meal: meal2,
            dates: [entry.dates[1]],
            expanded: false,
            replaceWithLeftover: false,
          },
        );
        return copy;
      });
    } else {
      // Simple in-place swap
      this.planEntries.update((es) => {
        const copy = [...es];
        copy[i] = { ...entry, meal };
        return copy;
      });
    }

    // Flash the updated card before closing the picker
    this.flashCard(i);
    this.closePicker();
  }

  // ── Utilities ─────────────────────────────────────────────────────────

  /** Returns a uniformly random element from `arr`. */
  private pickRandom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /**
   * Briefly highlights the card at `index` by setting `changedIndex`
   * and clearing it after the animation duration (800 ms).
   *
   * The signal change triggers Angular's OnPush change detection
   * automatically, so the CSS class binding updates without manual
   * calls to ChangeDetectorRef.
   */
  private flashCard(index: number): void {
    // Reset first so repeated replacements retrigger the animation
    this.changedIndex.set(null);
    // Microtask gap lets Angular remove the class before re-adding it,
    // ensuring the keyframe animation restarts correctly.
    Promise.resolve().then(() => {
      this.changedIndex.set(index);
      setTimeout(() => this.changedIndex.set(null), 800);
    });
  }
}
