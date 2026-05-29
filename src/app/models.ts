/**
 * A single ingredient as defined in ingredients.yaml.
 * The `name` is the key from the YAML map.
 */
export interface IngredientDefinition {
  /** Display name of the ingredient */
  name: string;
  /** Unit of measurement (e.g. 'g', 'ml', 'tsp'). Absent means "each". */
  unit?: string;
  /** Supermarket section used to group the shopping list */
  section: string;
}

/**
 * A reference to an ingredient within a meal, carrying the
 * quantity used in that recipe.
 */
export interface MealIngredient {
  /** Ingredient name matching a key in ingredients.yaml */
  name: string;
  /** Amount required; the unit is determined by IngredientDefinition.unit */
  quantity: number | string;
}

/**
 * A single entry in the meal plan, covering 1 or 2 consecutive days.
 * Two-day entries arise when the assigned meal is tagged 'leftovers'.
 */
export interface PlanEntry {
  /** The meal assigned to this slot */
  meal: Meal;
  /**
   * Dates covered by this entry.
   * Length 1 for a regular meal; length 2 for a leftovers meal
   * (which provides food for the following day as well).
   */
  dates: Date[];
  /** Whether the ingredient list card is currently expanded */
  expanded: boolean;
  /**
   * Only meaningful when `dates.length === 2`.
   * true  → a replacement should be another leftovers meal (keeps 2 days).
   * false → the entry should be split into two single-day meals.
   */
  replaceWithLeftover: boolean;
}

/** A single meal as defined in meals.yaml. */
export interface Meal {
  /** Human-readable name shown in the UI */
  title: string;
  /**
   * Optional classification tags (e.g. 'leftovers', 'convenience').
   * Used as Bootstrap badge labels.
   */
  tags?: string[];
  /** Ordered list of ingredients and quantities needed for this meal */
  ingredients: MealIngredient[];
}

/**
 * Raw shape of the top-level object parsed from meals.yaml.
 * Used only inside DataService to avoid exposing YAML internals.
 */
export interface MealsYaml {
  meals: Array<{
    title: string;
    tags?: string[];
    ingredients: Array<Record<string, number>>;
  }>;
}

/**
 * Raw shape of the top-level object parsed from ingredients.yaml.
 * Used only inside DataService to avoid exposing YAML internals.
 */
export interface IngredientsYaml {
  ingredients: Record<string, { unit?: string; section: string }>;
}
