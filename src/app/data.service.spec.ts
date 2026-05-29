import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';

import { DataService } from './data.service';

// ── YAML fixtures ─────────────────────────────────────────────────────────

const MEALS_YAML = `
meals:
  - title: Pasta
    ingredients:
      - Pasta: 200
      - Olive oil: 1
  - title: Beef casserole
    tags:
      - leftovers
    ingredients:
      - Beef (diced): 400
`;

/** Valid YAML that is missing the expected top-level key */
const BAD_MEALS_YAML = 'other: value';

const INGREDIENTS_YAML = `
ingredients:
  Pasta:
    unit: g
    section: Pantry
  Apple:
    section: Produce
`;

/** Valid YAML that is missing the expected top-level key */
const BAD_INGREDIENTS_YAML = 'other: value';

// ── Tests ─────────────────────────────────────────────────────────────────

describe('DataService', () => {
  let service: DataService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DataService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  // ── getMeals() ─────────────────────────────────────────────────────

  describe('getMeals()', () => {
    it('returns the correct number of meals', () => {
      let result: ReturnType<typeof Array.prototype.slice> = [];
      service.getMeals().subscribe((m) => (result = m));
      httpTesting.expectOne('/data/meals.yaml').flush(MEALS_YAML);
      expect(result).toHaveLength(2);
    });

    it('parses meal titles', () => {
      let result: any[] = [];
      service.getMeals().subscribe((m) => (result = m));
      httpTesting.expectOne('/data/meals.yaml').flush(MEALS_YAML);
      expect(result[0].title).toBe('Pasta');
    });

    it('maps ingredient entries to name/quantity pairs', () => {
      let result: any[] = [];
      service.getMeals().subscribe((m) => (result = m));
      httpTesting.expectOne('/data/meals.yaml').flush(MEALS_YAML);
      expect(result[0].ingredients).toEqual([
        { name: 'Pasta', quantity: 200 },
        { name: 'Olive oil', quantity: 1 },
      ]);
    });

    it('reads tags from the YAML', () => {
      let result: any[] = [];
      service.getMeals().subscribe((m) => (result = m));
      httpTesting.expectOne('/data/meals.yaml').flush(MEALS_YAML);
      expect(result[1].tags).toContain('leftovers');
    });

    it('propagates an error when the "meals" key is absent', () => {
      // withRetry() is applied to the http.get() source, BEFORE map().
      // Parse errors thrown inside map() therefore bypass retryWhen and
      // propagate directly to the subscriber after a single request.
      let err: Error | undefined;
      service.getMeals().subscribe({
        error: (e: Error) => (err = e),
      });
      httpTesting.expectOne('/data/meals.yaml').flush(BAD_MEALS_YAML);
      expect(err?.message).toContain('"meals"');
    });
  });

  // ── getIngredients() ───────────────────────────────────────────────

  describe('getIngredients()', () => {
    it('returns one entry per ingredient', () => {
      let result: any[] = [];
      service.getIngredients().subscribe((i) => (result = i));
      httpTesting
        .expectOne('/data/ingredients.yaml')
        .flush(INGREDIENTS_YAML);
      expect(result).toHaveLength(2);
    });

    it('reads the name, unit, and section fields', () => {
      let result: any[] = [];
      service.getIngredients().subscribe((i) => (result = i));
      httpTesting
        .expectOne('/data/ingredients.yaml')
        .flush(INGREDIENTS_YAML);
      const pasta = result.find((i: any) => i.name === 'Pasta');
      expect(pasta?.unit).toBe('g');
      expect(pasta?.section).toBe('Pantry');
    });

    it('leaves unit undefined for ingredients without one', () => {
      let result: any[] = [];
      service.getIngredients().subscribe((i) => (result = i));
      httpTesting
        .expectOne('/data/ingredients.yaml')
        .flush(INGREDIENTS_YAML);
      const apple = result.find((i: any) => i.name === 'Apple');
      expect(apple?.unit).toBeUndefined();
    });

    it('propagates an error when the "ingredients" key is absent', () => {
      // withRetry() is applied to the http.get() source, BEFORE map().
      // Parse errors thrown inside map() therefore bypass retryWhen and
      // propagate directly to the subscriber after a single request.
      let err: Error | undefined;
      service.getIngredients().subscribe({
        error: (e: Error) => (err = e),
      });
      httpTesting
        .expectOne('/data/ingredients.yaml')
        .flush(BAD_INGREDIENTS_YAML);
      expect(err?.message).toContain('"ingredients"');
    });
  });
});
