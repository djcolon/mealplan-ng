import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { provideRouter } from '@angular/router';

import { ShoppingListComponent } from './shopping-list';
import { DataService } from '../data.service';
import { PlanStorageService, CART_STORAGE_KEY } from '../plan-storage.service';
import { IngredientDefinition, Meal, PlanEntry } from '../models';

// ── Fixtures ──────────────────────────────────────────────────────────────

const ingredientDefs: IngredientDefinition[] = [
  { name: 'Pasta', unit: 'g', section: 'Pantry' },
  { name: 'Olive oil', unit: 'ml', section: 'Pantry' },
  { name: 'Tomato', section: 'Produce' },
  { name: 'Beef (diced)', unit: 'g', section: 'Meat' },
];

const mealPasta: Meal = {
  title: 'Pasta Bake',
  ingredients: [
    { name: 'Pasta', quantity: 200 },
    { name: 'Olive oil', quantity: 30 },
    { name: 'Tomato', quantity: 2 },
  ],
};

const mealBeef: Meal = {
  title: 'Beef Stew',
  tags: ['leftovers'],
  ingredients: [
    { name: 'Beef (diced)', quantity: 400 },
    { name: 'Tomato', quantity: 3 },
  ],
};

/** Meal whose ingredient has a non-numeric quantity */
const mealSalad: Meal = {
  title: 'Salad',
  ingredients: [{ name: 'Olive oil', quantity: 'to taste' }],
};

/** Meal that combines numeric and qualitative quantities of same ingredient */
const mealMixed: Meal = {
  title: 'Mixed',
  ingredients: [
    { name: 'Olive oil', quantity: 15 },
    { name: 'Olive oil', quantity: 'to taste' },
  ],
};

/** Builds a minimal PlanEntry */
function makeEntry(meal: Meal): PlanEntry {
  return {
    meal,
    dates: [new Date('2026-06-01')],
    expanded: false,
    replaceWithLeftover: false,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────

function setup(
  entries: PlanEntry[] = [],
  defs: IngredientDefinition[] = ingredientDefs,
) {
  const mockDataService = {
    getIngredients: vi.fn(() => of(defs)),
  };

  const mockPlanStorage = {
    load: vi.fn(() =>
      entries.length > 0
        ? { entries, startDate: '2026-06-01', endDate: '2026-06-07' }
        : null,
    ),
  };

  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: DataService, useValue: mockDataService },
      { provide: PlanStorageService, useValue: mockPlanStorage },
    ],
  });

  const fixture = TestBed.createComponent(ShoppingListComponent);
  const component = fixture.componentInstance;
  // ngOnInit loads plan + defs
  component.ngOnInit();
  return { fixture, component, mockDataService, mockPlanStorage };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('ShoppingListComponent', () => {
  beforeEach(() => {
    // Ensure a clean localStorage before each test so cart state
    // from one test cannot leak into the next.
    localStorage.clear();
  });

  // ── Loading / error state ─────────────────────────────────────────

  describe('initial state', () => {
    it('starts in the loading state', () => {
      // Don't call ngOnInit so the observable never resolves
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          {
            provide: DataService,
            useValue: { getIngredients: vi.fn(() => of([])) },
          },
          {
            provide: PlanStorageService,
            useValue: { load: vi.fn(() => null) },
          },
        ],
      });
      const { componentInstance } = TestBed.createComponent(
        ShoppingListComponent,
      );
      expect(componentInstance.loading()).toBe(true);
    });

    it('clears the loading flag after ingredients load', () => {
      const { component } = setup();
      expect(component.loading()).toBe(false);
    });

    it('sets error and clears loading when getIngredients fails', () => {
      const mockDataService = {
        getIngredients: vi.fn(() =>
          throwError(() => new Error('network fail')),
        ),
      };
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          { provide: DataService, useValue: mockDataService },
          {
            provide: PlanStorageService,
            useValue: { load: vi.fn(() => null) },
          },
        ],
      });
      const { componentInstance: c } = TestBed.createComponent(
        ShoppingListComponent,
      );
      c.ngOnInit();
      expect(c.loading()).toBe(false);
      expect(c.error()).toContain('network fail');
    });
  });

  // ── Empty states ──────────────────────────────────────────────────

  describe('empty plan', () => {
    it('has no plan entries when storage returns null', () => {
      const { component } = setup([]);
      expect(component.planEntries()).toHaveLength(0);
    });

    it('has no shopping groups when plan is empty', () => {
      const { component } = setup([]);
      expect(component.shoppingGroups()).toHaveLength(0);
    });
  });

  // ── Quantity aggregation ──────────────────────────────────────────

  describe('shoppingItems()', () => {
    it('lists one item per unique ingredient across the plan', () => {
      const { component } = setup([makeEntry(mealPasta)]);
      expect(component.shoppingItems()).toHaveLength(3);
    });

    it('sums numeric quantities for the same ingredient', () => {
      // Tomato appears in both meals: 2 + 3 = 5
      const { component } = setup([
        makeEntry(mealPasta),
        makeEntry(mealBeef),
      ]);
      const tomato = component
        .shoppingItems()
        .find((i) => i.name === 'Tomato');
      expect(tomato?.quantity).toBe(5);
    });

    it('sets quantity to null for purely qualitative ingredients', () => {
      const { component } = setup([makeEntry(mealSalad)]);
      const oil = component
        .shoppingItems()
        .find((i) => i.name === 'Olive oil');
      expect(oil?.quantity).toBeNull();
      expect(oil?.qualitative).toContain('to taste');
    });

    it(
      'stores numeric sum alongside qualitative strings when mixed',
      () => {
        // mealMixed has: Olive oil 15 (numeric) + "to taste" (string)
        const { component } = setup([makeEntry(mealMixed)]);
        const oil = component
          .shoppingItems()
          .find((i) => i.name === 'Olive oil');
        expect(oil?.quantity).toBe(15);
        expect(oil?.qualitative).toContain('to taste');
      },
    );

    it('resolves the section from ingredientDefs', () => {
      const { component } = setup([makeEntry(mealPasta)]);
      const pasta = component
        .shoppingItems()
        .find((i) => i.name === 'Pasta');
      expect(pasta?.section).toBe('Pantry');
    });

    it('falls back to "Other" for ingredients not in defs', () => {
      const mealUnknown: Meal = {
        title: 'Mystery',
        ingredients: [{ name: 'Dragon fruit', quantity: 1 }],
      };
      const { component } = setup([makeEntry(mealUnknown)]);
      const item = component.shoppingItems()[0];
      expect(item.section).toBe('Other');
    });

    it('sets latestDate to the date of the entry using the ingredient', () => {
      const d = new Date('2026-06-03');
      const entry: PlanEntry = {
        meal: mealPasta,
        dates: [d],
        expanded: false,
        replaceWithLeftover: false,
      };
      const { component } = setup([entry]);
      const pasta = component
        .shoppingItems()
        .find((i) => i.name === 'Pasta');
      expect(pasta?.latestDate).toEqual(d);
    });

    it(
      'uses the last date of a two-day entry as the latestDate',
      () => {
        // Leftovers span Mon + Tue — the ingredient is "used" on Tue
        const d1 = new Date('2026-06-01');
        const d2 = new Date('2026-06-02');
        const entry: PlanEntry = {
          meal: mealBeef,
          dates: [d1, d2],
          expanded: false,
          replaceWithLeftover: true,
        };
        const { component } = setup([entry]);
        const beef = component
          .shoppingItems()
          .find((i) => i.name === 'Beef (diced)');
        expect(beef?.latestDate).toEqual(d2);
      },
    );

    it(
      'picks the latest date when the same ingredient appears in '
        + 'multiple entries',
      () => {
        // Tomato in mealPasta (06/01) and mealBeef (06/03)
        const e1: PlanEntry = {
          meal: mealPasta,
          dates: [new Date('2026-06-01')],
          expanded: false,
          replaceWithLeftover: false,
        };
        const e2: PlanEntry = {
          meal: mealBeef,
          dates: [new Date('2026-06-03')],
          expanded: false,
          replaceWithLeftover: false,
        };
        const { component } = setup([e1, e2]);
        const tomato = component
          .shoppingItems()
          .find((i) => i.name === 'Tomato');
        expect(tomato?.latestDate).toEqual(new Date('2026-06-03'));
      },
    );
  });

  // ── Grouping and sorting ──────────────────────────────────────────

  describe('shoppingGroups()', () => {
    it('groups items by section', () => {
      // mealPasta: Pantry (Pasta, Olive oil) + Produce (Tomato)
      const { component } = setup([makeEntry(mealPasta)]);
      const sectionNames = component
        .shoppingGroups()
        .map((g) => g.section);
      expect(sectionNames).toContain('Pantry');
      expect(sectionNames).toContain('Produce');
    });

    it('sorts sections alphabetically', () => {
      // mealPasta + mealBeef: Meat, Pantry, Produce
      const { component } = setup([
        makeEntry(mealPasta),
        makeEntry(mealBeef),
      ]);
      const sectionNames = component
        .shoppingGroups()
        .map((g) => g.section);
      expect(sectionNames).toEqual([...sectionNames].sort());
    });

    it('sorts items within a section alphabetically by name', () => {
      // Pantry section from mealPasta: Olive oil, Pasta
      const { component } = setup([makeEntry(mealPasta)]);
      const pantry = component
        .shoppingGroups()
        .find((g) => g.section === 'Pantry')!;
      const names = pantry.items.map((i) => i.name);
      expect(names).toEqual([...names].sort());
    });
  });

  // ── toggle() ─────────────────────────────────────────────────────

  describe('toggle()', () => {
    it('adds the ingredient name to ticked when not present', () => {
      const { component } = setup([makeEntry(mealPasta)]);
      component.toggle('Pasta');
      expect(component.ticked().has('Pasta')).toBe(true);
    });

    it('removes the ingredient name from ticked when already present', () => {
      const { component } = setup([makeEntry(mealPasta)]);
      component.toggle('Pasta');
      component.toggle('Pasta');
      expect(component.ticked().has('Pasta')).toBe(false);
    });

    it('persists the ticked set to localStorage', () => {
      const { component } = setup([makeEntry(mealPasta)]);
      component.toggle('Pasta');
      const stored = JSON.parse(
        localStorage.getItem(CART_STORAGE_KEY) ?? '[]',
      ) as string[];
      expect(stored).toContain('Pasta');
    });
  });

  // ── Cart persistence ──────────────────────────────────────────────

  describe('cart persistence', () => {
    it('restores ticked items from localStorage on construction', () => {
      // Pre-populate localStorage before creating the component
      localStorage.setItem(
        CART_STORAGE_KEY,
        JSON.stringify(['Pasta', 'Tomato']),
      );

      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          {
            provide: DataService,
            useValue: { getIngredients: vi.fn(() => of(ingredientDefs)) },
          },
          {
            provide: PlanStorageService,
            useValue: {
              load: vi.fn(() => ({
                entries: [makeEntry(mealPasta)],
                startDate: '2026-06-01',
                endDate: '2026-06-07',
              })),
            },
          },
        ],
      });

      const { componentInstance: c } = TestBed.createComponent(
        ShoppingListComponent,
      );
      expect(c.ticked().has('Pasta')).toBe(true);
      expect(c.ticked().has('Tomato')).toBe(true);
    });
  });

  // ── formatQuantity() ──────────────────────────────────────────────

  /** Shared latestDate for formatQuantity fixtures */
  const anyDate = new Date('2026-06-01');

  describe('formatQuantity()', () => {
    it('formats a numeric quantity with a unit', () => {
      const { component } = setup();
      const result = component.formatQuantity({
        name: 'Pasta',
        section: 'Pantry',
        unit: 'g',
        quantity: 200,
        qualitative: [],
        latestDate: anyDate,
      });
      // Should contain the number and the unit
      expect(result).toContain('200');
      expect(result).toContain('g');
    });

    it('formats a numeric quantity without a unit', () => {
      const { component } = setup();
      const result = component.formatQuantity({
        name: 'Tomato',
        section: 'Produce',
        unit: undefined,
        quantity: 5,
        qualitative: [],
        latestDate: anyDate,
      });
      expect(result).toBe('5');
    });

    it('formats a qualitative-only quantity as the string value', () => {
      const { component } = setup();
      const result = component.formatQuantity({
        name: 'Olive oil',
        section: 'Pantry',
        unit: 'ml',
        quantity: null,
        qualitative: ['to taste'],
        latestDate: anyDate,
      });
      expect(result).toBe('to taste');
    });

    it('formats a mixed quantity as numeric + qualitative parts', () => {
      const { component } = setup();
      const result = component.formatQuantity({
        name: 'Olive oil',
        section: 'Pantry',
        unit: 'ml',
        quantity: 15,
        qualitative: ['to taste'],
        latestDate: anyDate,
      });
      expect(result).toContain('15');
      expect(result).toContain('to taste');
    });
  });

  // ── formatLatestDate() ────────────────────────────────────────────

  describe('formatLatestDate()', () => {
    it('includes the abbreviated weekday name', () => {
      const { component } = setup();
      // 2026-06-01 is a Monday
      const result = component.formatLatestDate(new Date(2026, 5, 1));
      expect(result).toContain('Mon');
    });

    it('includes the zero-padded month and day', () => {
      const { component } = setup();
      // 2026-06-01 → "06/01"
      const result = component.formatLatestDate(new Date(2026, 5, 1));
      expect(result).toContain('06/01');
    });

    it('zero-pads single-digit months and days', () => {
      const { component } = setup();
      // 2026-09-05 → "09/05"
      const result = component.formatLatestDate(new Date(2026, 8, 5));
      expect(result).toContain('09/05');
    });
  });
});
