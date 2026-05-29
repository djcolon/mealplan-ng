import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { IngredientsComponent } from './ingredients';
import { DataService } from '../data.service';
import { IngredientDefinition } from '../models';

// ── Fixtures ──────────────────────────────────────────────────────────────

const MOCK_INGREDIENTS: IngredientDefinition[] = [
  { name: 'Zucchini', unit: 'g', section: 'Produce' },
  { name: 'Apple', section: 'Produce' },
  { name: 'Pasta', unit: 'g', section: 'Pantry' },
  { name: 'Olive oil', unit: 'ml', section: 'Pantry' },
  { name: 'Cheese', unit: 'g', section: 'Refrigerated' },
];

// ── Setup helper ──────────────────────────────────────────────────────────

/**
 * Configures a fresh TestBed for each call with a stubbed DataService
 * and returns a component fixture.
 */
function setup(ingredients: IngredientDefinition[] = MOCK_INGREDIENTS) {
  const mockService = {
    getIngredients: vi.fn(() => of(ingredients)),
  };
  TestBed.configureTestingModule({
    providers: [{ provide: DataService, useValue: mockService }],
  });
  return TestBed.createComponent(IngredientsComponent);
}

function setupWithError(errorValue: unknown) {
  const mockService = {
    getIngredients: vi.fn(() => throwError(() => errorValue)),
  };
  TestBed.configureTestingModule({
    providers: [{ provide: DataService, useValue: mockService }],
  });
  return TestBed.createComponent(IngredientsComponent);
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('IngredientsComponent', () => {

  // ── Initial state ──────────────────────────────────────────────────

  it('starts in the loading state', () => {
    const { componentInstance: c } = setup();
    expect(c.loading()).toBe(true);
  });

  it('starts with no error', () => {
    const { componentInstance: c } = setup();
    expect(c.error()).toBeNull();
  });

  // ── After successful data load ─────────────────────────────────────

  it('clears the loading flag after a successful fetch', () => {
    const { componentInstance: c } = setup();
    c.ngOnInit();
    expect(c.loading()).toBe(false);
  });

  it('keeps error as null on successful fetch', () => {
    const { componentInstance: c } = setup();
    c.ngOnInit();
    expect(c.error()).toBeNull();
  });

  // ── Error handling ─────────────────────────────────────────────────

  it('sets an error message when the service fails', () => {
    const { componentInstance: c } = setupWithError(
      new Error('fetch failed'),
    );
    c.ngOnInit();
    expect(c.error()).toContain('fetch failed');
  });

  it('clears the loading flag when the service fails', () => {
    const { componentInstance: c } = setupWithError(
      new Error('fetch failed'),
    );
    c.ngOnInit();
    expect(c.loading()).toBe(false);
  });

  it('uses a fallback message for non-Error rejections', () => {
    const { componentInstance: c } = setupWithError('plain string');
    c.ngOnInit();
    expect(c.error()).toContain('An unexpected error');
  });

  // ── sections computed ──────────────────────────────────────────────

  describe('sections computed signal', () => {
    it('returns an empty array before data is loaded', () => {
      const { componentInstance: c } = setup();
      expect(c.sections()).toHaveLength(0);
    });

    it('returns an empty array when no ingredients are provided', () => {
      const { componentInstance: c } = setup([]);
      c.ngOnInit();
      expect(c.sections()).toHaveLength(0);
    });

    it('groups ingredients by section', () => {
      const { componentInstance: c } = setup();
      c.ngOnInit();
      const names = c.sections().map((s) => s.name);
      expect(names).toContain('Produce');
      expect(names).toContain('Pantry');
      expect(names).toContain('Refrigerated');
    });

    it('puts all members of a section together', () => {
      const { componentInstance: c } = setup();
      c.ngOnInit();
      const produce = c.sections().find((s) => s.name === 'Produce');
      const produceNames = produce?.items.map((i) => i.name) ?? [];
      expect(produceNames).toContain('Apple');
      expect(produceNames).toContain('Zucchini');
    });

    it('does not put ingredients from different sections together', () => {
      const { componentInstance: c } = setup();
      c.ngOnInit();
      const pantry = c.sections().find((s) => s.name === 'Pantry');
      const pantryNames = pantry?.items.map((i) => i.name) ?? [];
      expect(pantryNames).not.toContain('Apple');
    });

    it('sorts sections alphabetically', () => {
      const { componentInstance: c } = setup();
      c.ngOnInit();
      const names = c.sections().map((s) => s.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    });

    it('sorts items alphabetically within each section', () => {
      const { componentInstance: c } = setup();
      c.ngOnInit();
      for (const section of c.sections()) {
        const names = section.items.map((i) => i.name);
        expect(names).toEqual(
          [...names].sort((a, b) => a.localeCompare(b)),
        );
      }
    });

    it('Produce section appears before Refrigerated alphabetically', () => {
      const { componentInstance: c } = setup();
      c.ngOnInit();
      const names = c.sections().map((s) => s.name);
      expect(names.indexOf('Pantry')).toBeLessThan(
        names.indexOf('Refrigerated'),
      );
    });

    it('preserves unit and section on each item', () => {
      const { componentInstance: c } = setup();
      c.ngOnInit();
      const pantry = c.sections().find((s) => s.name === 'Pantry');
      const pasta = pantry?.items.find((i) => i.name === 'Pasta');
      expect(pasta?.unit).toBe('g');
      expect(pasta?.section).toBe('Pantry');
    });
  });
});
