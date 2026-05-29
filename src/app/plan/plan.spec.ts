import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { PlanComponent } from './plan';
import { DataService } from '../data.service';
import { IngredientDefinition, Meal, PlanEntry } from '../models';

// ── Fixtures ──────────────────────────────────────────────────────────────

/** Three ordinary (non-leftovers) meals */
const mealA: Meal = { title: 'Pasta', ingredients: [] };
const mealB: Meal = { title: 'Salad', ingredients: [] };
const mealC: Meal = { title: 'Soup', ingredients: [] };

/** Two meals tagged leftovers */
const leftoverMeal: Meal = {
  title: 'Beef casserole',
  tags: ['leftovers'],
  ingredients: [],
};
const leftoverMeal2: Meal = {
  title: 'Lasagna',
  tags: ['leftovers'],
  ingredients: [],
};

const ALL_MEALS = [mealA, mealB, mealC, leftoverMeal, leftoverMeal2];

// ── Helpers ───────────────────────────────────────────────────────────────

/** Builds a PlanEntry with sensible defaults for testing. */
function makeEntry(
  meal: Meal,
  dates: Date[],
  overrides: Partial<PlanEntry> = {},
): PlanEntry {
  return {
    meal,
    dates,
    expanded: false,
    replaceWithLeftover: true,
    ...overrides,
  };
}

/** Returns an array of n consecutive dates starting from `start`. */
function makeDates(start: Date, n: number): Date[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

/** Total number of calendar days covered by all plan entries. */
function totalDays(entries: PlanEntry[]): number {
  return entries.reduce((sum, e) => sum + e.dates.length, 0);
}

/**
 * Configures a fresh TestBed with a stubbed DataService and returns the
 * component instance. The service stub returns synchronous observables
 * so ngOnInit() resolves without async/fakeAsync.
 */
function setup(
  meals: Meal[] = ALL_MEALS,
  ingredients: IngredientDefinition[] = [],
) {
  const mockService = {
    getMeals: vi.fn(() => of(meals)),
    getIngredients: vi.fn(() => of(ingredients)),
  };
  TestBed.configureTestingModule({
    providers: [{ provide: DataService, useValue: mockService }],
  });
  const fixture = TestBed.createComponent(PlanComponent);
  return { fixture, component: fixture.componentInstance, mockService };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('PlanComponent', () => {

  // ── Initial state ──────────────────────────────────────────────────

  describe('initial state', () => {
    it('starts in the loading state', () => {
      const { component } = setup();
      expect(component.loading()).toBe(true);
    });

    it('has an empty plan', () => {
      const { component } = setup();
      expect(component.planEntries()).toHaveLength(0);
    });

    it('picker is closed', () => {
      const { component } = setup();
      expect(component.pickerOpen()).toBe(false);
    });

    it('defaults start date to tomorrow', () => {
      const { component } = setup();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const pad = (n: number) => String(n).padStart(2, '0');
      const expected = [
        tomorrow.getFullYear(),
        pad(tomorrow.getMonth() + 1),
        pad(tomorrow.getDate()),
      ].join('-');
      expect(component.startDate()).toBe(expected);
    });
  });

  // ── Data loading ───────────────────────────────────────────────────

  describe('ngOnInit()', () => {
    it('clears the loading flag on success', () => {
      const { component } = setup();
      component.ngOnInit();
      expect(component.loading()).toBe(false);
    });

    it('populates allMeals on success', () => {
      const { component } = setup();
      component.ngOnInit();
      expect(component.allMeals()).toHaveLength(ALL_MEALS.length);
    });

    it('sets error and clears loading on failure', () => {
      const mockService = {
        getMeals: vi.fn(() => throwError(() => new Error('oops'))),
        getIngredients: vi.fn(() => of([])),
      };
      TestBed.configureTestingModule({
        providers: [{ provide: DataService, useValue: mockService }],
      });
      const { componentInstance: c } =
        TestBed.createComponent(PlanComponent);
      c.ngOnInit();
      expect(c.loading()).toBe(false);
      expect(c.error()).toContain('oops');
    });
  });

  // ── generatePlan() ─────────────────────────────────────────────────

  describe('generatePlan()', () => {
    it('produces no entries when end is before start', () => {
      const { component } = setup([mealA, mealB]);
      component.allMeals.set([mealA, mealB]);
      component.startDate.set('2026-06-10');
      component.endDate.set('2026-06-05');
      component.generatePlan();
      expect(component.planEntries()).toHaveLength(0);
    });

    it('covers exactly 1 day for a single-day range', () => {
      const { component } = setup([mealA]);
      component.allMeals.set([mealA]);
      component.startDate.set('2026-06-01');
      component.endDate.set('2026-06-01');
      component.generatePlan();
      expect(totalDays(component.planEntries())).toBe(1);
    });

    it('covers all 7 days for a weekly range (only single meals)', () => {
      const singles = [mealA, mealB, mealC];
      const { component } = setup(singles);
      component.allMeals.set(singles);
      component.startDate.set('2026-06-01');
      component.endDate.set('2026-06-07');
      component.generatePlan();
      expect(totalDays(component.planEntries())).toBe(7);
    });

    it(
      'gives a leftovers entry 2 dates when ≥ 2 days remain',
      () => {
        // Only the leftovers meal available, so it must be selected
        const { component } = setup([leftoverMeal]);
        component.allMeals.set([leftoverMeal]);
        component.startDate.set('2026-06-01');
        component.endDate.set('2026-06-02');
        component.generatePlan();
        expect(component.planEntries()[0].dates).toHaveLength(2);
      },
    );

    it(
      'extends a leftovers entry on the last day to 2 dates',
      () => {
        // The requested range is a single day but the only available meal
        // is tagged leftovers.  extendIfLastIsLeftover adds a second
        // "leftover day" and advances the end-date picker.
        const { component } = setup([leftoverMeal]);
        component.allMeals.set([leftoverMeal]);
        component.startDate.set('2026-06-01');
        component.endDate.set('2026-06-01');
        component.generatePlan();
        expect(component.planEntries()[0].dates).toHaveLength(2);
        expect(component.endDate()).toBe('2026-06-02');
      },
    );

    it('starts every new entry in the collapsed state', () => {
      const { component } = setup([mealA, mealB]);
      component.allMeals.set([mealA, mealB]);
      component.startDate.set('2026-06-01');
      component.endDate.set('2026-06-03');
      component.generatePlan();
      for (const e of component.planEntries()) {
        expect(e.expanded).toBe(false);
      }
    });

    it(
      'covers at least 7 days regardless of leftover spans',
      () => {
        // Mix of single and leftovers so spans vary.  If the last meal
        // is a leftovers meal, extendIfLastIsLeftover adds 1 extra day.
        const { component } = setup();
        component.allMeals.set(ALL_MEALS);
        component.startDate.set('2026-06-01');
        component.endDate.set('2026-06-07');
        component.generatePlan();
        expect(totalDays(component.planEntries())).toBeGreaterThanOrEqual(7);
      },
    );
  });

  // ── toggleExpanded() ───────────────────────────────────────────────

  describe('toggleExpanded()', () => {
    it('expands a collapsed entry', () => {
      const { component } = setup();
      component.planEntries.set([makeEntry(mealA, [new Date()])]);
      component.toggleExpanded(0);
      expect(component.planEntries()[0].expanded).toBe(true);
    });

    it('collapses an expanded entry', () => {
      const { component } = setup();
      component.planEntries.set([
        makeEntry(mealA, [new Date()], { expanded: true }),
      ]);
      component.toggleExpanded(0);
      expect(component.planEntries()[0].expanded).toBe(false);
    });

    it('only toggles the targeted entry', () => {
      const { component } = setup();
      const d = [new Date()];
      component.planEntries.set([makeEntry(mealA, d), makeEntry(mealB, d)]);
      component.toggleExpanded(0);
      expect(component.planEntries()[0].expanded).toBe(true);
      expect(component.planEntries()[1].expanded).toBe(false);
    });
  });

  // ── setReplaceMode() ───────────────────────────────────────────────

  describe('setReplaceMode()', () => {
    it('sets replaceWithLeftover to false', () => {
      const { component } = setup();
      component.planEntries.set([
        makeEntry(leftoverMeal, [new Date(), new Date()]),
      ]);
      component.setReplaceMode(0, false);
      expect(component.planEntries()[0].replaceWithLeftover).toBe(false);
    });

    it('sets replaceWithLeftover to true', () => {
      const { component } = setup();
      component.planEntries.set([
        makeEntry(leftoverMeal, [new Date(), new Date()], {
          replaceWithLeftover: false,
        }),
      ]);
      component.setReplaceMode(0, true);
      expect(component.planEntries()[0].replaceWithLeftover).toBe(true);
    });

    it('syncs pickerLeftover when the picker is open for that entry', () => {
      const { component } = setup();
      component.planEntries.set([
        makeEntry(leftoverMeal, [new Date(), new Date()]),
      ]);
      component.pickerEntryIndex.set(0);
      component.setReplaceMode(0, false);
      expect(component.pickerLeftover()).toBe(false);
    });

    it(
      'does not sync pickerLeftover when the picker targets a different entry',
      () => {
        const { component } = setup();
        const d = [new Date()];
        component.planEntries.set([makeEntry(mealA, d), makeEntry(mealB, d)]);
        component.pickerEntryIndex.set(1);
        component.pickerLeftover.set(true);
        component.setReplaceMode(0, false);
        expect(component.pickerLeftover()).toBe(true);
      },
    );
  });

  // ── replaceRandom() ────────────────────────────────────────────────

  describe('replaceRandom()', () => {
    it('keeps a single-day entry as a single-day entry', () => {
      const { component } = setup([mealA, mealB]);
      component.allMeals.set([mealA, mealB]);
      component.planEntries.set([makeEntry(mealA, [new Date()])]);
      component.replaceRandom(0);
      expect(component.planEntries()).toHaveLength(1);
      expect(component.planEntries()[0].dates).toHaveLength(1);
    });

    it(
      'keeps a leftovers entry as 2 dates in leftover-swap mode',
      () => {
        const { component } = setup([leftoverMeal, leftoverMeal2]);
        component.allMeals.set([leftoverMeal, leftoverMeal2]);
        component.planEntries.set([
          makeEntry(leftoverMeal, [new Date(), new Date()], {
            replaceWithLeftover: true,
          }),
        ]);
        component.replaceRandom(0);
        expect(component.planEntries()).toHaveLength(1);
        expect(component.planEntries()[0].dates).toHaveLength(2);
      },
    );

    it(
      'replaces a leftovers entry with a leftovers meal in swap mode',
      () => {
        const { component } = setup([leftoverMeal, leftoverMeal2]);
        component.allMeals.set([leftoverMeal, leftoverMeal2]);
        component.planEntries.set([
          makeEntry(leftoverMeal, [new Date(), new Date()], {
            replaceWithLeftover: true,
          }),
        ]);
        component.replaceRandom(0);
        const newMeal = component.planEntries()[0].meal;
        expect(newMeal.tags).toContain('leftovers');
      },
    );

    it('splits a leftovers entry into 2 entries in split mode', () => {
      const { component } = setup([mealA, mealB, leftoverMeal]);
      component.allMeals.set([mealA, mealB, leftoverMeal]);
      const d1 = new Date('2026-06-01');
      const d2 = new Date('2026-06-02');
      component.planEntries.set([
        makeEntry(leftoverMeal, [d1, d2], { replaceWithLeftover: false }),
      ]);
      component.replaceRandom(0);
      expect(component.planEntries()).toHaveLength(2);
    });

    it('assigns each split entry to its original date', () => {
      const { component } = setup([mealA, mealB]);
      component.allMeals.set([mealA, mealB]);
      const d1 = new Date('2026-06-01');
      const d2 = new Date('2026-06-02');
      component.planEntries.set([
        makeEntry(leftoverMeal, [d1, d2], { replaceWithLeftover: false }),
      ]);
      component.replaceRandom(0);
      expect(component.planEntries()[0].dates[0]).toEqual(d1);
      expect(component.planEntries()[1].dates[0]).toEqual(d2);
    });

    it('does not assign a leftovers meal to split entries', () => {
      const { component } = setup([mealA, mealB]);
      component.allMeals.set([mealA, mealB]);
      component.planEntries.set([
        makeEntry(leftoverMeal, [new Date(), new Date()], {
          replaceWithLeftover: false,
        }),
      ]);
      component.replaceRandom(0);
      for (const e of component.planEntries()) {
        expect(e.meal.tags?.includes('leftovers') ?? false).toBe(false);
      }
    });

    it(
      'extends the plan by 1 day when a leftovers meal ends up last',
      () => {
        // Only a leftovers meal is available, so replaceRandom must pick
        // it.  The entry sits on the last date, so extendIfLastIsLeftover
        // adds a second date and advances endDate by 1 day.
        const { component } = setup([leftoverMeal]);
        component.allMeals.set([leftoverMeal]);
        const d = new Date('2026-06-05');
        component.planEntries.set([makeEntry(mealA, [d])]);
        component.endDate.set('2026-06-05');
        component.replaceRandom(0);
        expect(component.planEntries()[0].dates).toHaveLength(2);
        expect(component.endDate()).toBe('2026-06-06');
      },
    );
  });

  // ── deleteEntry() ──────────────────────────────────────────────────

  describe('deleteEntry()', () => {
    it('removes the entry from the plan', () => {
      const { component } = setup();
      const d1 = new Date('2026-06-01');
      const d2 = new Date('2026-06-02');
      component.planEntries.set([
        makeEntry(mealA, [d1]),
        makeEntry(mealB, [d2]),
      ]);
      component.deleteEntry(0);
      expect(component.planEntries()).toHaveLength(1);
      expect(component.planEntries()[0].meal.title).toBe(mealB.title);
    });

    it('shifts subsequent dates back by 1 for a single-day entry', () => {
      const { component } = setup();
      const d1 = new Date('2026-06-01');
      const d2 = new Date('2026-06-02');
      const d3 = new Date('2026-06-03');
      component.planEntries.set([
        makeEntry(mealA, [d1]),
        makeEntry(mealB, [d2]),
        makeEntry(mealC, [d3]),
      ]);
      component.deleteEntry(0);
      // B and C each shift back by 1 day
      expect(component.planEntries()[0].dates[0]).toEqual(
        new Date('2026-06-01'),
      );
      expect(component.planEntries()[1].dates[0]).toEqual(
        new Date('2026-06-02'),
      );
    });

    it('shifts subsequent dates back by 2 for a two-day entry', () => {
      const { component } = setup();
      const dates = makeDates(new Date('2026-06-01'), 2); // Mon + Tue
      const d3 = new Date('2026-06-03');
      component.planEntries.set([
        makeEntry(leftoverMeal, dates),
        makeEntry(mealA, [d3]),
      ]);
      component.deleteEntry(0);
      expect(component.planEntries()).toHaveLength(1);
      // mealA shifts back by 2 days: 06/03 → 06/01
      expect(component.planEntries()[0].dates[0]).toEqual(
        new Date('2026-06-01'),
      );
    });

    it('does not shift entries before the deleted one', () => {
      const { component } = setup();
      const d1 = new Date('2026-06-01');
      const d2 = new Date('2026-06-02');
      const d3 = new Date('2026-06-03');
      component.planEntries.set([
        makeEntry(mealA, [d1]),
        makeEntry(mealB, [d2]),
        makeEntry(mealC, [d3]),
      ]);
      component.deleteEntry(1); // delete mealB
      // mealA is before the deleted entry and must not move
      expect(component.planEntries()[0].dates[0]).toEqual(d1);
      // mealC shifts back by 1
      expect(component.planEntries()[1].dates[0]).toEqual(
        new Date('2026-06-02'),
      );
    });

    it('updates endDate to the new last date', () => {
      const { component } = setup();
      component.planEntries.set([
        makeEntry(mealA, [new Date('2026-06-01')]),
        makeEntry(mealB, [new Date('2026-06-02')]),
        makeEntry(mealC, [new Date('2026-06-03')]),
      ]);
      component.endDate.set('2026-06-03');
      component.deleteEntry(2); // delete last entry
      expect(component.endDate()).toBe('2026-06-02');
    });

    it('shrinks endDate when the only entry is deleted', () => {
      const { component } = setup();
      component.planEntries.set([
        makeEntry(mealA, [new Date('2026-06-05')]),
      ]);
      component.endDate.set('2026-06-05');
      component.deleteEntry(0);
      expect(component.planEntries()).toHaveLength(0);
      expect(component.endDate()).toBe('2026-06-04');
    });
  });

  // ── openPicker() / closePicker() ───────────────────────────────────

  describe('openPicker()', () => {
    it('sets pickerEntryIndex to the target index', () => {
      const { component } = setup();
      component.planEntries.set([makeEntry(mealA, [new Date()])]);
      component.openPicker(0);
      expect(component.pickerEntryIndex()).toBe(0);
    });

    it('initialises pickerLeftover from the entry flag', () => {
      const { component } = setup();
      component.planEntries.set([
        makeEntry(leftoverMeal, [new Date(), new Date()], {
          replaceWithLeftover: false,
        }),
      ]);
      component.openPicker(0);
      expect(component.pickerLeftover()).toBe(false);
    });

    it('sets pickerOpen to true', () => {
      const { component } = setup();
      component.planEntries.set([makeEntry(mealA, [new Date()])]);
      component.openPicker(0);
      expect(component.pickerOpen()).toBe(true);
    });
  });

  describe('closePicker()', () => {
    it('clears pickerEntryIndex', () => {
      const { component } = setup();
      component.pickerEntryIndex.set(0);
      component.closePicker();
      expect(component.pickerEntryIndex()).toBeNull();
    });

    it('sets pickerOpen to false', () => {
      const { component } = setup();
      component.pickerEntryIndex.set(0);
      component.closePicker();
      expect(component.pickerOpen()).toBe(false);
    });
  });

  // ── isPickerSelectable() ───────────────────────────────────────────

  describe('isPickerSelectable()', () => {
    it('returns true for any meal when entry is a single day', () => {
      const { component } = setup();
      component.planEntries.set([makeEntry(mealA, [new Date()])]);
      component.pickerEntryIndex.set(0);
      expect(component.isPickerSelectable(leftoverMeal)).toBe(true);
      expect(component.isPickerSelectable(mealB)).toBe(true);
    });

    it(
      'accepts only leftovers meals in leftover mode',
      () => {
        const { component } = setup();
        component.planEntries.set([
          makeEntry(leftoverMeal, [new Date(), new Date()]),
        ]);
        component.pickerEntryIndex.set(0);
        component.pickerLeftover.set(true);
        expect(component.isPickerSelectable(leftoverMeal2)).toBe(true);
        expect(component.isPickerSelectable(mealA)).toBe(false);
      },
    );

    it('accepts only single meals in split mode', () => {
      const { component } = setup();
      component.planEntries.set([
        makeEntry(leftoverMeal, [new Date(), new Date()]),
      ]);
      component.pickerEntryIndex.set(0);
      component.pickerLeftover.set(false);
      expect(component.isPickerSelectable(mealA)).toBe(true);
      expect(component.isPickerSelectable(leftoverMeal2)).toBe(false);
    });
  });

  // ── pickerMealsInPlan ──────────────────────────────────────────────

  describe('pickerMealsInPlan', () => {
    it('includes the titles of all other entries', () => {
      const { component } = setup();
      component.planEntries.set([
        makeEntry(mealA, [new Date()]),
        makeEntry(mealB, [new Date()]),
      ]);
      component.pickerEntryIndex.set(0);
      expect(component.pickerMealsInPlan().has(mealB.title)).toBe(true);
    });

    it('excludes the title of the entry being replaced', () => {
      const { component } = setup();
      component.planEntries.set([
        makeEntry(mealA, [new Date()]),
        makeEntry(mealB, [new Date()]),
      ]);
      component.pickerEntryIndex.set(0);
      expect(component.pickerMealsInPlan().has(mealA.title)).toBe(false);
    });
  });

  // ── confirmPick() ──────────────────────────────────────────────────

  describe('confirmPick()', () => {
    it('replaces the meal in a single-day entry in-place', () => {
      const { component } = setup([mealA, mealB]);
      component.allMeals.set([mealA, mealB]);
      component.planEntries.set([makeEntry(mealA, [new Date()])]);
      component.pickerEntryIndex.set(0);
      component.confirmPick(mealB);
      expect(component.planEntries()[0].meal.title).toBe(mealB.title);
      expect(component.planEntries()).toHaveLength(1);
    });

    it('preserves the entry date when swapping a single-day entry', () => {
      const { component } = setup([mealA, mealB]);
      component.allMeals.set([mealA, mealB]);
      const d = new Date('2026-06-01');
      component.planEntries.set([makeEntry(mealA, [d])]);
      component.pickerEntryIndex.set(0);
      component.confirmPick(mealB);
      expect(component.planEntries()[0].dates[0]).toEqual(d);
    });

    it('keeps 2 dates when swapping leftovers-for-leftovers', () => {
      const { component } = setup([leftoverMeal, leftoverMeal2]);
      component.allMeals.set([leftoverMeal, leftoverMeal2]);
      const dates = makeDates(new Date('2026-06-01'), 2);
      component.planEntries.set([makeEntry(leftoverMeal, dates)]);
      component.pickerEntryIndex.set(0);
      component.pickerLeftover.set(true);
      component.confirmPick(leftoverMeal2);
      expect(component.planEntries()).toHaveLength(1);
      expect(component.planEntries()[0].meal.title).toBe(leftoverMeal2.title);
      expect(component.planEntries()[0].dates).toHaveLength(2);
    });

    it('splits into 2 entries in split mode', () => {
      const { component } = setup([mealA, mealB, leftoverMeal]);
      component.allMeals.set([mealA, mealB, leftoverMeal]);
      const dates = makeDates(new Date('2026-06-01'), 2);
      component.planEntries.set([makeEntry(leftoverMeal, dates)]);
      component.pickerEntryIndex.set(0);
      component.pickerLeftover.set(false);
      component.confirmPick(mealA);
      expect(component.planEntries()).toHaveLength(2);
    });

    it('assigns the picked meal to day 1 of the split', () => {
      const { component } = setup([mealA, mealB, leftoverMeal]);
      component.allMeals.set([mealA, mealB, leftoverMeal]);
      const dates = makeDates(new Date('2026-06-01'), 2);
      component.planEntries.set([makeEntry(leftoverMeal, dates)]);
      component.pickerEntryIndex.set(0);
      component.pickerLeftover.set(false);
      component.confirmPick(mealA);
      expect(component.planEntries()[0].meal.title).toBe(mealA.title);
    });

    it('day 2 of a split is not a leftovers meal', () => {
      const { component } = setup([mealA, mealB, leftoverMeal]);
      component.allMeals.set([mealA, mealB, leftoverMeal]);
      const dates = makeDates(new Date('2026-06-01'), 2);
      component.planEntries.set([makeEntry(leftoverMeal, dates)]);
      component.pickerEntryIndex.set(0);
      component.pickerLeftover.set(false);
      component.confirmPick(mealA);
      const day2 = component.planEntries()[1];
      expect(day2.meal.tags?.includes('leftovers') ?? false).toBe(false);
    });

    it('closes the picker after confirming', () => {
      const { component } = setup([mealA, mealB]);
      component.allMeals.set([mealA, mealB]);
      component.planEntries.set([makeEntry(mealA, [new Date()])]);
      component.pickerEntryIndex.set(0);
      component.confirmPick(mealB);
      expect(component.pickerOpen()).toBe(false);
    });

    it(
      'extends the plan by 1 day when a leftovers meal is picked last',
      () => {
        // Picking a leftovers meal for the last single-day entry calls
        // expandToLeftover, whose fallback then calls
        // extendIfLastIsLeftover to add the second date.
        const { component } = setup([mealA, leftoverMeal]);
        component.allMeals.set([mealA, leftoverMeal]);
        const d = new Date('2026-06-07');
        component.planEntries.set([makeEntry(mealA, [d])]);
        component.endDate.set('2026-06-07');
        component.pickerEntryIndex.set(0);
        component.confirmPick(leftoverMeal);
        expect(component.planEntries()[0].dates).toHaveLength(2);
        expect(component.endDate()).toBe('2026-06-08');
      },
    );

    it(
      'extends by 1 day when expandToLeftover shifts leftovers to last',
      () => {
        // Plan: A[Mon], B[Tue], C[Wed], D_leftovers[Thu,Fri].
        // Expanding A to a leftovers meal redistributes all dates:
        // leftoverMeal[Mon,Tue], B[Wed], C[Thu], D_leftovers[Fri].
        // D_leftovers ends up with only 1 date; extendIfLastIsLeftover
        // must append Sat and advance endDate.
        const { component } = setup([leftoverMeal, mealA, mealB, mealC]);
        component.allMeals.set([leftoverMeal, mealA, mealB, mealC]);
        component.planEntries.set([
          makeEntry(mealA,        [new Date('2026-06-01')]),
          makeEntry(mealB,        [new Date('2026-06-02')]),
          makeEntry(mealC,        [new Date('2026-06-03')]),
          makeEntry(
            leftoverMeal2,
            [new Date('2026-06-04'), new Date('2026-06-05')],
            { replaceWithLeftover: true },
          ),
        ]);
        component.endDate.set('2026-06-05');
        component.pickerEntryIndex.set(0);
        component.confirmPick(leftoverMeal);

        const entries = component.planEntries();
        expect(entries).toHaveLength(4);
        // D_leftovers was compressed to 1 date; must now span 2 dates
        expect(entries[3].dates).toHaveLength(2);
        expect(component.endDate()).toBe('2026-06-06');
      },
    );
  });

  // ── formatEntryDates() ─────────────────────────────────────────────

  describe('formatEntryDates()', () => {
    it('formats a single date in long form (weekday, MM/DD/YYYY)', () => {
      const { component } = setup();
      // Monday 1 June 2026
      const result = component.formatEntryDates([new Date(2026, 5, 1)]);
      expect(result).toMatch(/Monday/);
      expect(result).toMatch(/06\/01\/2026/);
    });

    it('formats two dates as an abbreviated range with an en-dash', () => {
      const { component } = setup();
      const d1 = new Date(2026, 5, 1); // Mon 1 Jun
      const d2 = new Date(2026, 5, 2); // Tue 2 Jun
      const result = component.formatEntryDates([d1, d2]);
      expect(result).toContain('–');
    });

    it('abbreviated range includes both dates in MM/DD format', () => {
      const { component } = setup();
      const d1 = new Date(2026, 5, 1); // 06/01
      const d2 = new Date(2026, 5, 2); // 06/02
      const result = component.formatEntryDates([d1, d2]);
      expect(result).toMatch(/06\/01/);
      expect(result).toMatch(/06\/02/);
    });
  });

  // ── unitFor() ──────────────────────────────────────────────────────

  describe('unitFor()', () => {
    it('returns undefined before data is loaded', () => {
      const { component } = setup();
      expect(component.unitFor('Pasta')).toBeUndefined();
    });

    it('returns the unit for a known ingredient after loading', () => {
      const ingredients: IngredientDefinition[] = [
        { name: 'Pasta', unit: 'g', section: 'Pantry' },
      ];
      const { component } = setup(ALL_MEALS, ingredients);
      component.ngOnInit();
      expect(component.unitFor('Pasta')).toBe('g');
    });

    it('returns undefined for an ingredient not in the map', () => {
      const { component } = setup();
      component.ngOnInit();
      expect(component.unitFor('Tomato')).toBeUndefined();
    });
  });
});
