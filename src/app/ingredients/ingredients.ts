import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';

import { DataService } from '../data.service';
import { IngredientDefinition } from '../models';

/**
 * Displays all ingredients grouped by their supermarket section.
 * Sections are shown as Bootstrap accordion panels, each containing a
 * sortable table of ingredient names and units.
 *
 * Data is loaded from ingredients.yaml via DataService on component init.
 */
@Component({
  selector: 'app-ingredients',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ingredients.html',
})
export class IngredientsComponent implements OnInit {
  private readonly dataService = inject(DataService);

  /** Flat list of all ingredients, as loaded from the YAML file */
  private readonly allIngredients = signal<IngredientDefinition[]>([]);

  /** Human-readable error message shown when the data load fails */
  readonly error = signal<string | null>(null);

  /** True while the initial data fetch is in progress */
  readonly loading = signal(true);

  /**
   * Ingredients grouped by section, sorted alphabetically first by
   * section name and then by ingredient name within each section.
   */
  readonly sections = computed<{ name: string; items: IngredientDefinition[] }[]>(() => {
    const map = new Map<string, IngredientDefinition[]>();

    for (const ingredient of this.allIngredients()) {
      const group = map.get(ingredient.section) ?? [];
      group.push(ingredient);
      map.set(ingredient.section, group);
    }

    // Sort sections alphabetically, then sort items within each section
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, items]) => ({
        name,
        items: items.sort((a, b) => a.name.localeCompare(b.name)),
      }));
  });

  ngOnInit(): void {
    this.dataService.getIngredients().subscribe({
      next: (ingredients) => {
        this.allIngredients.set(ingredients);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        const message =
          err instanceof Error
            ? err.message
            : 'An unexpected error occurred while loading ingredients.';
        console.error(
          'IngredientsComponent: failed to load ingredients.yaml',
          err,
        );
        this.error.set(
          `Could not load ingredients data. Please refresh the page.` +
            ` (${message})`,
        );
        this.loading.set(false);
      },
    });
  }
}
