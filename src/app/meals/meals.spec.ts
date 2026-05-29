import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { MealsComponent } from './meals';
import { DataService } from '../data.service';
import { IngredientDefinition, Meal } from '../models';

// ── Fixtures ──────────────────────────────────────────────────────────────

const MOCK_MEALS: Meal[] = [
  {
    title: 'Pasta',
    ingredients: [{ name: 'Pasta', quantity: 200 }],
  },
  {
    title: 'Chicken curry',
    tags: ['convenience'],
    ingredients: [],
  },
  {
    title: 'Beef casserole',
    tags: ['leftovers'],
    ingredients: [{ name: 'Beef (diced)', quantity: 400 }],
  },
];

const MOCK_INGREDIENTS: IngredientDefinition[] = [
  { name: 'Pasta', unit: 'g', section: 'Pantry' },
  { name: 'Beef (diced)', unit: 'g', section: 'Refrigerated' },
];

// ── Setup helper ──────────────────────────────────────────────────────────

/**
 * Configures a fresh TestBed for each call with stubbed DataService
 * observables and returns a component fixture.
 *
 * Call `fixture.componentInstance.ngOnInit()` inside a test to
 * simulate the full data-loading lifecycle.
 */
function setup(
  mealsObservable = of(MOCK_MEALS),
  ingredientsObservable = of(MOCK_INGREDIENTS),
) {
  const mockService = {
    getMeals: vi.fn(() => mealsObservable),
    getIngredients: vi.fn(() => ingredientsObservable),
  };

  TestBed.configureTestingModule({
    providers: [{ provide: DataService, useValue: mockService }],
  });

  return TestBed.createComponent(MealsComponent);
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('MealsComponent', () => {

  // ── Initial state ──────────────────────────────────────────────────

  it('starts in the loading state', () => {
    const fixture = setup();
    expect(fixture.componentInstance.loading()).toBe(true);
  });

  it('starts with no error', () => {
    const fixture = setup();
    expect(fixture.componentInstance.error()).toBeNull();
  });

  it('starts with an empty result set', () => {
    const fixture = setup();
    expect(fixture.componentInstance.filteredMeals()).toHaveLength(0);
  });

  // ── After successful data load ─────────────────────────────────────

  it('clears the loading flag after a successful fetch', () => {
    const fixture = setup();
    fixture.componentInstance.ngOnInit();
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  it('exposes all loaded meals via filteredMeals', () => {
    const fixture = setup();
    fixture.componentInstance.ngOnInit();
    expect(fixture.componentInstance.filteredMeals()).toHaveLength(3);
  });

  // ── Error handling ─────────────────────────────────────────────────

  it('sets an error message when the service fails', () => {
    const fixture = setup(
      throwError(() => new Error('Network error')),
    );
    fixture.componentInstance.ngOnInit();
    expect(fixture.componentInstance.error()).toContain('Network error');
  });

  it('clears the loading flag when the service fails', () => {
    const fixture = setup(throwError(() => new Error('fail')));
    fixture.componentInstance.ngOnInit();
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  it('uses a fallback message for non-Error rejections', () => {
    const fixture = setup(throwError(() => 'plain string error'));
    fixture.componentInstance.ngOnInit();
    expect(fixture.componentInstance.error()).toContain(
      'An unexpected error',
    );
  });

  // ── filteredMeals search ───────────────────────────────────────────

  describe('filteredMeals', () => {
    it('returns all meals when the query is empty', () => {
      const fixture = setup();
      fixture.componentInstance.ngOnInit();
      fixture.componentInstance.searchQuery.set('');
      expect(fixture.componentInstance.filteredMeals()).toHaveLength(3);
    });

    it('filters by partial case-insensitive match', () => {
      const fixture = setup();
      fixture.componentInstance.ngOnInit();
      fixture.componentInstance.searchQuery.set('chicken');
      const results = fixture.componentInstance.filteredMeals();
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Chicken curry');
    });

    it('returns multiple results when several titles match', () => {
      const fixture = setup();
      fixture.componentInstance.ngOnInit();
      // "a" matches Pasta, Beef casserole, Chicken curry
      fixture.componentInstance.searchQuery.set('a');
      expect(
        fixture.componentInstance.filteredMeals().length,
      ).toBeGreaterThan(1);
    });

    it('returns an empty array when no meals match', () => {
      const fixture = setup();
      fixture.componentInstance.ngOnInit();
      fixture.componentInstance.searchQuery.set('xyznotameal');
      expect(fixture.componentInstance.filteredMeals()).toHaveLength(0);
    });

    it('trims leading and trailing whitespace from the query', () => {
      const fixture = setup();
      fixture.componentInstance.ngOnInit();
      fixture.componentInstance.searchQuery.set('  pasta  ');
      expect(fixture.componentInstance.filteredMeals()).toHaveLength(1);
    });

    it('is case-insensitive (upper-case query)', () => {
      const fixture = setup();
      fixture.componentInstance.ngOnInit();
      fixture.componentInstance.searchQuery.set('PASTA');
      expect(fixture.componentInstance.filteredMeals()).toHaveLength(1);
    });
  });

  // ── tagClass() ─────────────────────────────────────────────────────

  describe('tagClass()', () => {
    it('returns the info class for "leftovers"', () => {
      const { componentInstance: c } = setup();
      expect(c.tagClass('leftovers')).toBe('bg-info text-dark');
    });

    it('returns the warning class for "convenience"', () => {
      const { componentInstance: c } = setup();
      expect(c.tagClass('convenience')).toBe('bg-warning text-dark');
    });

    it('returns the secondary class for unrecognised tags', () => {
      const { componentInstance: c } = setup();
      expect(c.tagClass('vegetarian')).toBe('bg-secondary');
    });
  });

  // ── unitFor() ──────────────────────────────────────────────────────

  describe('unitFor()', () => {
    it('returns the unit for a known ingredient', () => {
      const fixture = setup();
      fixture.componentInstance.ngOnInit();
      expect(fixture.componentInstance.unitFor('Pasta')).toBe('g');
    });

    it('returns undefined for an ingredient not in the unit map', () => {
      const fixture = setup();
      fixture.componentInstance.ngOnInit();
      // 'Tomato' exists in the data but was not included in the mock
      expect(
        fixture.componentInstance.unitFor('Tomato'),
      ).toBeUndefined();
    });

    it('returns undefined before data has been loaded', () => {
      const fixture = setup();
      // ngOnInit not called → unit map is empty
      expect(
        fixture.componentInstance.unitFor('Pasta'),
      ).toBeUndefined();
    });
  });
});
