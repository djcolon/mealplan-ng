import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { forkJoin } from 'rxjs';

import { DataService } from '../data.service';
import { PlanStorageService } from '../plan-storage.service';
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
       * Flex-column list of plan rows.  Each row is a flex row
       * with the date label fixed-width on the left and the meal
       * card filling the rest on the right.
       * Using a flex row (not CSS Grid) guarantees the day-header
       * always stretches to match the card height via
       * align-items: stretch, even for leftover entries.
       */
      .plan-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .plan-row {
        display: flex;
        align-items: stretch;
        gap: 0.75rem;
        /* anchor the ::before / ::after drop-indicator lines */
        position: relative;
      }

      /* Date label \u2014 fixed width, fills full row height via flex */
      .day-header {
        flex: 0 0 5rem;
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
       * Leftover date label covers both days.
       * space-evenly distributes the two day-blocks across the
       * full height of the taller meal card.
       */
      .day-header--leftover {
        justify-content: space-evenly;
      }
      .day-header--leftover .day-divider {
        width: 70%;
        border: none;
        border-top: 1px solid rgba(0, 0, 0, 0.15);
        margin: 0.25rem 0;
      }

      /* Meal cards fill the remaining row width */
      .meal-card {
        flex: 1 1 auto;
        min-width: 0;
      }

      /*
       * For leftover cards the card is taller than its collapsed
       * content (header + footer).  Bootstrap's .card is a flex
       * column, so the extra height appears as dead space below the
       * card-header.  Setting flex: 1 on the card-header makes it
       * grow to absorb that space, which in turn pushes the
       * card-footer to the bottom of the card.
       */
      .meal-card .card-header {
        flex: 1 1 auto;
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

      /* Dragged row fades so the gap it leaves is visible. */
      .plan-row.is-dragging { opacity: 0.25; }

      /* ── Drop indicator line ─────────────────────────────── */
      /*
       * A 3 px blue line rendered via ::before (before a row) or
       * ::after (after the last row).  Spans the full row width.
       */
      .plan-row.drop-before::before,
      .plan-row.drop-after::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        height: 3px;
        background: #0d6efd;
        border-radius: 2px;
        z-index: 10;
        pointer-events: none;
      }
      /* Centre the line in the 0.75rem row-gap (half = 0.375rem) */
      .plan-row.drop-before::before { top:    calc(-0.375rem - 1.5px); }
      .plan-row.drop-after::after   { bottom: calc(-0.375rem - 1.5px); }

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

      /* ── Picker card tag accents ─────────────────────────── */
      /*
       * A 4 px inset box-shadow on the left edge acts as a colour-
       * coded tag indicator without disrupting the button's own
       * border or layout.
       */
      .picker-btn.picker-tag-leftovers {
        box-shadow: inset 4px 0 0 0 #0dcaf0;
      }
      .picker-btn.picker-tag-convenience {
        box-shadow: inset 4px 0 0 0 #ffc107;
      }
    `,
  ],
})
export class PlanComponent implements OnInit {
  private readonly dataService = inject(DataService);
  private readonly planStorage = inject(PlanStorageService);

  /**
   * Restores a previously saved plan from localStorage (synchronously,
   * before any network activity) so the user sees their plan
   * immediately on re-opening the app.
   *
   * Sets up a reactive `effect()` that auto-saves the plan to
   * localStorage whenever `planEntries`, `startDate`, or `endDate`
   * changes.  When the plan is empty the saved entry is removed so a
   * future visit starts fresh.
   */
  constructor() {
    // Restore persisted plan before the first render
    const saved = this.planStorage.load();
    if (saved) {
      this.planEntries.set(saved.entries);
      this.startDate.set(saved.startDate);
      this.endDate.set(saved.endDate);
    }

    // Auto-persist whenever any part of the plan state changes.
    // Angular schedules effects after change detection, so by the time
    // this first runs the signals already hold the restored values.
    effect(() => {
      const entries = this.planEntries();
      const start = this.startDate();
      const end = this.endDate();

      if (entries.length > 0) {
        this.planStorage.save(entries, start, end);
      } else {
        // Plan was cleared — remove the stored entry so the next
        // visit starts with an empty plan rather than a stale one.
        this.planStorage.clear();
      }
    });
  }

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

  /** Free-text search query for filtering the picker meal list. */
  readonly pickerSearch = signal('');

  /**
   * Alphabetically sorted list of all meals, filtered by the
   * current `pickerSearch` query (case-insensitive partial match
   * on the meal title).
   *
   * Selectable / non-selectable logic is handled separately in the
   * template via `isPickerSelectable()`, so all meals are shown here
   * but disabled ones remain visible (greyed out) so the user can
   * see the full catalogue.
   */
  readonly pickerFilteredMeals = computed(() => {
    const q = this.pickerSearch().trim().toLowerCase();
    return [...this.allMeals()]
      .sort((a, b) => a.title.localeCompare(b.title))
      .filter((m) => !q || m.title.toLowerCase().includes(q));
  });

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
    // If the last picked meal needs a "leftover day", extend the plan.
    this.extendIfLastIsLeftover();
  }

  /** Clears all plan entries without changing the date pickers.
   *
   * Also removes the persisted plan from localStorage so that
   * a page reload starts with an empty plan.
   */
  clearPlan(): void {
    // The effect() will call planStorage.clear() when it observes the
    // empty array, but we call it here too so the storage is cleared
    // synchronously before any potential navigation away from the page.
    this.planStorage.clear();
    this.planEntries.set([]);
  }

  /**
   * Prepends one new day before the first entry in the plan.
   *
   * A single random meal is generated for that day, and the
   * `startDate` picker is moved back by one day to stay in sync.
   */
  prependDay(): void {
    const entries = this.planEntries();
    if (entries.length === 0) return;

    const firstDate = entries[0].dates[0];
    const newDate = addDays(firstDate, -1);

    // Pick a meal that isn't already used in the plan
    const used = new Set(entries.map((e) => e.meal.title));
    const pool = this.allMeals().filter((m) => !used.has(m.title));
    const meal = this.pickRandom(pool.length ? pool : this.allMeals());

    this.planEntries.update((es) => [
      { meal, dates: [newDate], expanded: false, replaceWithLeftover: true },
      ...es,
    ]);

    // Keep the date picker in sync
    this.startDate.set(toInputDate(newDate));
  }

  /**
   * Appends one new day after the last entry in the plan.
   *
   * A single random meal is generated for that day, and the
   * `endDate` picker is moved forward by one day to stay in sync.
   */
  appendDay(): void {
    const entries = this.planEntries();
    if (entries.length === 0) return;

    const lastEntry = entries[entries.length - 1];
    const lastDate = lastEntry.dates[lastEntry.dates.length - 1];
    const newDate = addDays(lastDate, 1);

    // Pick a meal that isn't already used in the plan
    const used = new Set(entries.map((e) => e.meal.title));
    const pool = this.allMeals().filter((m) => !used.has(m.title));
    const meal = this.pickRandom(pool.length ? pool : this.allMeals());

    this.planEntries.update((es) => [
      ...es,
      { meal, dates: [newDate], expanded: false, replaceWithLeftover: true },
    ]);

    // Keep the date picker in sync
    this.endDate.set(toInputDate(newDate));
  }

  /**
   * Deletes the entry at index `i` from the plan.
   *
   * Entries that follow the deleted one are shifted backwards:
   * each of their dates is moved earlier by the number of days
   * the deleted entry occupied (1 for a single-day entry, 2 for
   * a two-day leftovers entry).
   *
   * The end-date picker is also moved back by the same amount so
   * it stays in sync with the shortened plan.
   */
  deleteEntry(i: number): void {
    const entries = this.planEntries();
    const removed = entries[i];
    const shift = removed.dates.length; // days to pull subsequent entries back

    const updated = entries
      .filter((_, idx) => idx !== i)
      .map((entry, idx) => {
        // Only entries that were originally AFTER the deleted one move back
        if (idx < i) return entry;
        return {
          ...entry,
          dates: entry.dates.map((d) => addDays(d, -shift)),
        };
      });

    this.planEntries.set(updated);

    // Shrink the end-date picker to match the new last date
    if (updated.length > 0) {
      const last = updated[updated.length - 1];
      this.endDate.set(
        toInputDate(last.dates[last.dates.length - 1]),
      );
    } else {
      // Plan is now empty; pull the end date back by the deleted span
      const currentEnd = fromInputDate(this.endDate());
      this.endDate.set(toInputDate(addDays(currentEnd, -shift)));
    }
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
   *
   * When the chosen meal has the 'leftovers' tag and the entry is
   * currently single-day, the entry expands to span two days and
   * the last entry in the plan is removed to preserve the date range.
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

    // If a single-day entry gains a leftovers meal, expand it to 2 days
    if (!isLeftoverEntry && newMeal.tags?.includes('leftovers')) {
      this.expandToLeftover(i, newMeal);
      return;
    }

    this.planEntries.update((es) => {
      const copy = [...es];
      copy[i] = { ...entry, meal: newMeal };
      return copy;
    });
    // Extend the plan if a leftovers meal ends up on the last day.
    this.extendIfLastIsLeftover();
  }

  // ── Picker ────────────────────────────────────────────────────────────

  /** Opens the picker modal targeting the entry at index `i`. */
  openPicker(i: number): void {
    const entry = this.planEntries()[i];
    this.pickerEntryIndex.set(i);
    this.pickerLeftover.set(entry.replaceWithLeftover);
    // Always start with an empty search so all meals are visible
    this.pickerSearch.set('');
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
    } else if (
      !this.isPickerForLeftovers() &&
      (meal.tags?.includes('leftovers') ?? false)
    ) {
      // Single-day entry → leftovers meal: expand to 2 days, drop the
      // last entry to keep the total date range unchanged.
      this.expandToLeftover(i, meal);
    } else {
      // Simple in-place swap (same span)
      this.planEntries.update((es) => {
        const copy = [...es];
        copy[i] = { ...entry, meal };
        return copy;
      });
      // Extend the plan if a leftovers meal ends up on the last day.
      this.extendIfLastIsLeftover();
    }

    // Flash the updated card before closing the picker
    this.flashCard(i);
    this.closePicker();
  }

  // ── Utilities ─────────────────────────────────────────────────────────

  /**
   * Returns a CSS class name for the left-border tag accent applied
   * to picker cards.  Leftovers takes priority when a meal has both
   * tags, since it has the greater structural impact on the plan.
   *
   * Returns an empty string when the meal has no recognised tags.
   */
  pickerTagClass(meal: Meal): string {
    const tags = meal.tags ?? [];
    if (tags.includes('leftovers')) return 'picker-tag-leftovers';
    if (tags.includes('convenience')) return 'picker-tag-convenience';
    return '';
  }

  /** Returns a uniformly random element from `arr`. */
  private pickRandom<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /**
   * Expands the single-day entry at index `i` into a two-day leftover
   * entry, redistributing all subsequent entries onto the dates that
   * follow.  Because the expanded entry consumes one extra date slot,
   * the last entry in the plan is dropped to keep the total date range
   * the same.
   *
   * If the entry sits on the very last date (no room to span two days)
   * the meal is assigned as a single-day entry instead.
   */
  private expandToLeftover(i: number, newMeal: Meal): void {
    const entries = this.planEntries();
    // Flat ordered list of every date currently in the plan
    const allDates = entries.flatMap((e) => e.dates);

    // Where does entry i start in the flat date array?
    const dateOffset = entries
      .slice(0, i)
      .reduce((sum, e) => sum + e.dates.length, 0);

    if (dateOffset + 1 >= allDates.length) {
      // Entry is on the last available date: assign the meal in-place.
      // extendIfLastIsLeftover() below will add the second date needed.
      this.planEntries.update((es) => {
        const copy = [...es];
        copy[i] = { ...entries[i], meal: newMeal, replaceWithLeftover: true };
        return copy;
      });
    } else {
      // Walk through entries in order, reassigning dates sequentially.
      // Entry i gets 2 dates; all subsequent entries keep their original
      // span but their starting date shifts by 1.  Any entry that runs
      // out of dates is silently dropped.  If the new last entry is a
      // leftovers meal, extendIfLastIsLeftover() below adds the extra day.
      const result: PlanEntry[] = [];
      let cursor = 0;

      for (let j = 0; j < entries.length; j++) {
        if (j === i) {
          result.push({
            ...entries[j],
            meal: newMeal,
            dates: allDates.slice(cursor, cursor + 2),
            replaceWithLeftover: true,
          });
          cursor += 2;
        } else {
          const span = entries[j].dates.length;
          const newDates = allDates.slice(cursor, cursor + span);
          // No dates left — this entry (and any after it) is dropped
          if (newDates.length === 0) break;
          result.push({ ...entries[j], dates: newDates });
          cursor += newDates.length;
        }
      }

      this.planEntries.set(result);
    }

    // Extend the plan if the new last entry is a leftovers meal covering
    // only one day (either because it was always last, or because date
    // redistribution shifted a leftovers meal to the last slot).
    this.extendIfLastIsLeftover();
  }

  /**
   * Checks whether the last plan entry is a leftovers meal that only
   * covers a single day.  If it is, the entry is extended to two days
   * by appending the next calendar date, and the end-date picker is
   * advanced accordingly.
   *
   * Called after any operation that could place a leftovers meal at the
   * end of the plan: generation, random replacement, picker selection,
   * or an expandToLeftover cascade.
   */
  private extendIfLastIsLeftover(): void {
    const entries = this.planEntries();
    if (entries.length === 0) return;

    const last = entries[entries.length - 1];
    const isLeftovers = last.meal.tags?.includes('leftovers') ?? false;

    // Already spans two days, or is not a leftovers meal — nothing to do
    if (!isLeftovers || last.dates.length >= 2) return;

    // Add the calendar day immediately following the current last date
    const extraDate = addDays(last.dates[last.dates.length - 1], 1);

    this.planEntries.update((es) => {
      const copy = [...es];
      const lastEntry = copy[copy.length - 1];
      copy[copy.length - 1] = {
        ...lastEntry,
        dates: [...lastEntry.dates, extraDate],
        replaceWithLeftover: true,
      };
      return copy;
    });

    // Keep the end-date picker in sync with the extended date range
    this.endDate.set(toInputDate(extraDate));
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
