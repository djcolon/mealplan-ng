import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, throwError, timer } from 'rxjs';
import { catchError, map, mergeMap, retryWhen, tap } from 'rxjs/operators';
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

/** localStorage key for cached parsed meals */
const MEALS_CACHE_KEY = 'mealplan-meals-cache';

/** localStorage key for cached parsed ingredients */
const INGREDIENTS_CACHE_KEY = 'mealplan-ingredients-cache';

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
 * Reads a value from localStorage, returning `null` on any failure
 * (quota exceeded, private mode, parse errors, etc.).
 */
function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Writes a value to localStorage.  Silently ignores write failures.
 */
function writeCache(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`DataService: could not write cache key "${key}".`, err);
  }
}

/**
 * DataService loads and parses the application's YAML data files
 * (meals.yaml and ingredients.yaml) from the `data/` static asset
 * directory.  Each method returns a cold Observable that fetches the
 * relevant file on subscription, applying automatic exponential
 * back-off retries on network failure.
 */
@Injectable({ providedIn: 'root' })
export class DataService {
  private readonly http = inject(HttpClient);

  /**
   * Fetches and parses `data/meals.yaml`, returning an array of
   * {@link Meal} objects with typed, flattened ingredient lists.
   *
   * On a successful fetch the parsed result is written to localStorage
   * so subsequent visits can load data instantly even when offline.
   * If the network request fails (after retries), the cached data is
   * used as a fallback.  An error is only thrown when no cached data
   * exists either.
   */
  getMeals(): Observable<Meal[]> {
    return this.http
      .get('data/meals.yaml', { responseType: 'text' })
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
        // Cache the freshly parsed meals for offline use
        tap((meals) => writeCache(MEALS_CACHE_KEY, meals)),
        catchError((err) => {
          // Network/parse failed — try the localStorage cache
          const cached = readCache<Meal[]>(MEALS_CACHE_KEY);
          if (cached) {
            console.warn(
              'DataService: network unavailable, using cached meals.',
            );
            return of(cached);
          }
          // No cache available; propagate the original error
          return throwError(() => err);
        }),
      );
  }

  /**
   * Fetches and parses `data/ingredients.yaml`, returning a flat
   * array of {@link IngredientDefinition} objects sorted alphabetically
   * by name within each section.
   *
   * Caching behaviour mirrors {@link getMeals}: localStorage is written
   * on success and read as a fallback on network failure.
   */
  getIngredients(): Observable<IngredientDefinition[]> {
    return this.http
      .get('data/ingredients.yaml', { responseType: 'text' })
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
        // Cache the freshly parsed ingredients for offline use
        tap((ingredients) => writeCache(INGREDIENTS_CACHE_KEY, ingredients)),
        catchError((err) => {
          // Network/parse failed — try the localStorage cache
          const cached = readCache<IngredientDefinition[]>(
            INGREDIENTS_CACHE_KEY,
          );
          if (cached) {
            console.warn(
              'DataService: network unavailable, using cached ingredients.',
            );
            return of(cached);
          }
          return throwError(() => err);
        }),
      );
  }
}
