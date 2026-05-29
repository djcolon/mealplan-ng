import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { DataService } from '../data.service';
import { PlanStorageService, CART_STORAGE_KEY } from '../plan-storage.service';
import { IngredientDefinition, PlanEntry } from '../models';

// ── Local types ───────────────────────────────────────────────────────────

/**
 * A single aggregated line in the shopping list.
 *
 * Quantities of the same ingredient across all meals are combined:
 * numeric quantities are summed; non-numeric strings (e.g. "to taste")
 * are collected in `qualitative`.
 */
export interface ShoppingItem {
  /** Ingredient name */
  name: string;
  /** Supermarket section from ingredients.yaml (default "Other") */
  section: string;
  /** Unit from ingredients.yaml, absent for "each" items */
  unit?: string;
  /**
   * Sum of all numeric quantities, or null when every occurrence
   * of this ingredient has a non-numeric quantity.
   */
  quantity: number | null;
  /**
   * Unique non-numeric quantity strings encountered across all meals
   * (e.g. ["to taste", "a pinch"]).
   */
  qualitative: string[];
  /**
   * The latest date on which this ingredient is needed by any meal
   * in the plan.  For a leftovers entry the relevant date is the
   * last day of the span (i.e. the day the leftovers are eaten).
   *
   * Helps the shopper pick a suitable use-by date when buying.
   */
  latestDate: Date;
}

/** A named section of the shopping list containing its items. */
export interface ShoppingGroup {
  section: string;
  items: ShoppingItem[];
}

// ── Component ─────────────────────────────────────────────────────────────

/**
 * Displays the aggregated shopping list derived from the current meal
 * plan, grouped by supermarket section.
 *
 * Each ingredient line has a checkbox so the user can tick items off as
 * they put them in their basket.  Ticked state is persisted to
 * localStorage and is cleared automatically when the plan is cleared.
 */
@Component({
  selector: 'app-shopping-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './shopping-list.html',
})
export class ShoppingListComponent implements OnInit {
  private readonly dataService = inject(DataService);
  private readonly planStorage = inject(PlanStorageService);

  /** True while the ingredient definitions are being fetched. */
  readonly loading = signal(true);

  /** Non-null when the ingredient fetch failed. */
  readonly error = signal<string | null>(null);

  /**
   * Plan entries loaded synchronously from localStorage.
   * Empty array when no plan has been saved yet.
   */
  readonly planEntries = signal<PlanEntry[]>([]);

  /**
   * Ingredient definitions fetched from DataService.
   * Used to resolve the section and unit for each ingredient.
   */
  private readonly ingredientDefs = signal<IngredientDefinition[]>([]);

  /**
   * Set of ingredient names that have been ticked off.
   * Persisted to localStorage so the cart survives navigation.
   */
  readonly ticked = signal<Set<string>>(new Set());

  /**
   * All shopping items aggregated from the plan entries.
   *
   * Numeric quantities for the same ingredient are summed across all
   * meals; non-numeric strings are deduplicated into `qualitative`.
   * Section and unit are resolved from `ingredientDefs`; ingredients
   * not found in the definitions fall into the "Other" section.
   */
  readonly shoppingItems = computed<ShoppingItem[]>(() => {
    const entries = this.planEntries();
    const defs = this.ingredientDefs();
    const defMap = new Map(defs.map((d) => [d.name, d]));

    // Accumulate quantities keyed by ingredient name.
    // Also track the latest date each ingredient appears in the plan.
    const acc = new Map<
      string,
      {
        num: number;
        hasNumeric: boolean;
        quals: Set<string>;
        latestDate: Date;
      }
    >();

    for (const entry of entries) {
      // For a leftovers entry the last date is when the food is consumed
      const entryDate = entry.dates[entry.dates.length - 1];

      for (const ing of entry.meal.ingredients) {
        if (!acc.has(ing.name)) {
          acc.set(ing.name, {
            num: 0,
            hasNumeric: false,
            quals: new Set(),
            latestDate: entryDate,
          });
        }
        const row = acc.get(ing.name)!;

        // Keep the furthest date seen across all entries using this
        // ingredient so the shopper knows the latest use-by needed.
        if (entryDate > row.latestDate) {
          row.latestDate = entryDate;
        }

        if (typeof ing.quantity === 'number') {
          row.num += ing.quantity;
          row.hasNumeric = true;
        } else {
          // Treat any non-number as a qualitative string
          row.quals.add(String(ing.quantity));
        }
      }
    }

    return Array.from(acc.entries()).map(([name, row]) => {
      const def = defMap.get(name);
      return {
        name,
        section: def?.section ?? 'Other',
        unit: def?.unit,
        // quantity is null when every occurrence was non-numeric
        quantity: row.hasNumeric ? row.num : null,
        qualitative: [...row.quals],
        latestDate: row.latestDate,
      };
    });
  });

  /**
   * Shopping items grouped by section, both sections and items within
   * each section sorted alphabetically.
   */
  readonly shoppingGroups = computed<ShoppingGroup[]>(() => {
    const groups = new Map<string, ShoppingItem[]>();

    for (const item of this.shoppingItems()) {
      if (!groups.has(item.section)) {
        groups.set(item.section, []);
      }
      groups.get(item.section)!.push(item);
    }

    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([section, items]) => ({
        section,
        items: items.sort((a, b) => a.name.localeCompare(b.name)),
      }));
  });

  constructor() {
    // Restore previously ticked items from localStorage
    try {
      const raw = localStorage.getItem(CART_STORAGE_KEY);
      if (raw) {
        this.ticked.set(new Set(JSON.parse(raw) as string[]));
      }
    } catch {
      // Ignore corrupt data — start with an empty cart
    }
  }

  ngOnInit(): void {
    // Load plan entries synchronously from localStorage
    const saved = this.planStorage.load();
    if (saved) {
      this.planEntries.set(saved.entries);
    }

    // Ingredient definitions are needed for section and unit metadata.
    // The DataService falls back to its localStorage cache when offline.
    this.dataService.getIngredients().subscribe({
      next: (defs) => {
        this.ingredientDefs.set(defs);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        const message =
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred.';
        console.error(
          'ShoppingListComponent: failed to load ingredient data',
          err,
        );
        this.error.set(
          `Could not load ingredient data. Please refresh the page.` +
            ` (${message})`,
        );
        this.loading.set(false);
      },
    });
  }

  /**
   * Toggles the ticked state of the ingredient identified by `name`.
   * The updated set is written to localStorage immediately so that a
   * navigation away from the page does not lose any ticks.
   */
  toggle(name: string): void {
    this.ticked.update((set) => {
      // Always create a new Set so Angular's signal change detection
      // recognises the reference as changed (Sets are mutable).
      const next = new Set(set);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });

    // Persist immediately rather than waiting for the effect tick so
    // that navigating away right after a toggle does not lose the state.
    try {
      localStorage.setItem(
        CART_STORAGE_KEY,
        JSON.stringify([...this.ticked()]),
      );
    } catch (err) {
      console.warn(
        'ShoppingListComponent: could not persist cart.',
        err,
      );
    }
  }

  /**
   * Formats the combined quantity and unit of a shopping item for
   * display in the UI.
   *
   * Examples:
   * - Numeric only: "500 g" or "2" (no unit)
   * - Qualitative only: "to taste"
   * - Mixed: "200 g + to taste"
   */
  formatQuantity(item: ShoppingItem): string {
    // Narrow non-breaking space (U+202F) keeps the number and unit
    // together when the line wraps on small screens.
    const numPart =
      item.quantity !== null
        ? `${item.quantity}${item.unit ? '\u202f' + item.unit : ''}`
        : null;
    const strPart =
      item.qualitative.length > 0
        ? item.qualitative.join(', ')
        : null;
    return [numPart, strPart].filter(Boolean).join(' + ');
  }

  /**
   * Formats the latest date an ingredient is needed as a short
   * weekday + MM/DD string, e.g. "Wed 06/04".
   *
   * This gives the shopper a quick reference for choosing a suitable
   * use-by date when purchasing the ingredient.
   */
  formatLatestDate(date: Date): string {
    const weekday = date.toLocaleDateString('en-US', { weekday: 'short' });
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${weekday} ${mm}/${dd}`;
  }
}
