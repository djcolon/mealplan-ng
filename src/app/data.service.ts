import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError, timer } from 'rxjs';
import { map, mergeMap, retryWhen } from 'rxjs/operators';
import { load } from 'js-yaml';

import {
  IngredientDefinition,
  IngredientsYaml,
  Meal,
  MealsYaml,
  MealIngredient,
} from './models';

/** Maximum number of fetch attempts before giving up */
const MAX_RETRIES = 3;

/** Base delay (ms) for exponential back-off between retries */
const RETRY_DELAY_MS = 1000;

/**
 * Returns an RxJS operator that retries a failed observable up to
 * `MAX_RETRIES` times with exponential back-off.
 */
function withRetry<T>() {
  return retryWhen<T>((errors) =>
    errors.pipe(
      mergeMap((error: unknown, attempt: number) => {
        if (attempt >= MAX_RETRIES - 1) {
          // Exhausted retries — propagate the original error
          return throwError(() => error);
        }
        // Exponential back-off: 1s, 2s, 4s …
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        console.warn(
          `DataService: fetch failed (attempt ${attempt + 1}), ` +
            `retrying in ${delay}ms…`,
          error,
        );
        return timer(delay);
      }),
    ),
  );
}

/**
 * DataService loads and parses the application's YAML data files
 * (meals.yaml and ingredients.yaml) from the `/data/` static asset
 * directory.  Each method returns a cold Observable that fetches the
 * relevant file on subscription, applying automatic exponential
 * back-off retries on network failure.
 */
@Injectable({ providedIn: 'root' })
export class DataService {
  private readonly http = inject(HttpClient);

  /**
   * Fetches and parses `/data/meals.yaml`, returning an array of
   * {@link Meal} objects with typed, flattened ingredient lists.
   */
  getMeals(): Observable<Meal[]> {
    return this.http
      .get('/data/meals.yaml', { responseType: 'text' })
      .pipe(
        withRetry(),
        map((text) => {
          const parsed = load(text) as MealsYaml;

          if (!parsed?.meals) {
            throw new Error(
              'meals.yaml does not contain a top-level "meals" key.',
            );
          }

          return parsed.meals.map((raw) => {
            // Each ingredient is a single-key map: { "Name": quantity }
            const ingredients: MealIngredient[] = (raw.ingredients ?? []).map(
              (entry) => {
                const [name, quantity] = Object.entries(entry)[0];
                return { name, quantity };
              },
            );

            return {
              title: raw.title,
              tags: raw.tags,
              ingredients,
            } satisfies Meal;
          });
        }),
      );
  }

  /**
   * Fetches and parses `/data/ingredients.yaml`, returning a flat
   * array of {@link IngredientDefinition} objects sorted alphabetically
   * by name within each section.
   */
  getIngredients(): Observable<IngredientDefinition[]> {
    return this.http
      .get('/data/ingredients.yaml', { responseType: 'text' })
      .pipe(
        withRetry(),
        map((text) => {
          const parsed = load(text) as IngredientsYaml;

          if (!parsed?.ingredients) {
            throw new Error(
              'ingredients.yaml does not contain a top-level' +
                ' "ingredients" key.',
            );
          }

          return Object.entries(parsed.ingredients).map(([name, def]) => ({
            name,
            unit: def.unit,
            section: def.section,
          }));
        }),
      );
  }
}
