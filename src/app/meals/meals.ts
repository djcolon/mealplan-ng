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
import { IngredientDefinition, Meal } from '../models';

/**
 * Displays all available meals as Bootstrap cards in a responsive grid.
 * Each card shows the meal title, optional classification tags, and the
 * list of ingredients required.
 *
 * Data is loaded from meals.yaml via DataService on component init.
 */
@Component({
  selector: 'app-meals',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './meals.html',
})
export class MealsComponent implements OnInit {
  private readonly dataService = inject(DataService);

  /** All meals loaded from the YAML file */
  private readonly meals = signal<Meal[]>([]);

  /**
   * Map of ingredient name → unit string, built from ingredients.yaml.
   * Used to display the correct unit alongside each quantity in the
   * meal cards. An absent entry means the ingredient is measured in
   * individual items ("each").
   */
  private readonly unitMap = signal<Map<string, string | undefined>>(
    new Map(),
  );

  /** Human-readable error message shown when the data load fails */
  readonly error = signal<string | null>(null);

  /** True while the initial data fetch is in progress */
  readonly loading = signal(true);

  /** Current value of the search input; updated on every keystroke */
  readonly searchQuery = signal('');

  /**
   * Subset of meals whose title contains the search query (case-
   * insensitive partial match). Returns all meals when the query is
   * empty.
   */
  readonly filteredMeals = computed(() => {
    const query = this.searchQuery().trim().toLowerCase();
    if (!query) return this.meals();
    return this.meals().filter((m) =>
      m.title.toLowerCase().includes(query),
    );
  });

  ngOnInit(): void {
    // Fetch meals and ingredients in parallel; both are needed before
    // the view can render unit-annotated ingredient quantities.
    forkJoin({
      meals: this.dataService.getMeals(),
      ingredients: this.dataService.getIngredients(),
    }).subscribe({
      next: ({ meals, ingredients }) => {
        this.meals.set(meals);
        this.unitMap.set(
          new Map(
            ingredients.map((i: IngredientDefinition) => [i.name, i.unit]),
          ),
        );
        this.loading.set(false);
      },
      error: (err: unknown) => {
        const message =
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred while loading meals.';
        console.error('MealsComponent: failed to load data', err);
        this.error.set(
          `Could not load meals data. Please refresh the page. (${message})`,
        );
        this.loading.set(false);
      },
    });
  }

  /**
   * Returns the unit string for a named ingredient, or undefined when
   * the ingredient is measured in individual items ("each").
   */
  unitFor(ingredientName: string): string | undefined {
    return this.unitMap().get(ingredientName);
  }

  /**
   * Maps a tag string to a Bootstrap contextual colour class so tags
   * are colour-coded consistently across the UI.
   */
  tagClass(tag: string): string {
    const map: Record<string, string> = {
      leftovers: 'bg-info text-dark',
      convenience: 'bg-warning text-dark',
    };
    return map[tag] ?? 'bg-secondary';
  }
}
