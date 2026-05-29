# Meal Planner

A weekly meal-planning web application built with Angular 21.

The app lets you:

- **Generate a meal plan** — pick a date range and the app randomly assigns
  meals across those days, automatically spanning leftover-friendly meals
  over two consecutive days.
- **Customise the plan** — replace any meal with a random pick or choose
  one manually from a searchable picker. Leftover entries can be swapped for
  another leftovers meal or split into two independent single-day meals.
- **Browse meals** — view all available meals as cards with their
  ingredients, quantities, and units. Filter by name using the search bar.
- **Browse ingredients** — view all ingredients grouped by supermarket
  section in an expandable accordion.

Meal and ingredient data are loaded from YAML files in the `data/` directory,
making it straightforward to add or edit meals without touching any code.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to
`http://localhost:4200/`. The application reloads automatically whenever you
modify a source file.

## Building

To build the project run:

```bash
ng build
```

This compiles the project and writes build artefacts to the `dist/` directory.
By default, the production build is optimised for performance and speed.

## Running unit tests

The project uses [Vitest](https://vitest.dev/) as the test runner (via the
Angular build system).

**Run tests in watch mode** (reruns on file changes — useful during development):

```bash
ng test
```

**Run tests once** (useful for CI or a quick check):

```bash
ng test --watch=false
```

**Run tests with coverage**:

```bash
ng test --coverage
```

The test suite covers all five modules:

| File | Tests |
|------|-------|
| `src/app/app.spec.ts` | Root component and navigation |
| `src/app/data.service.spec.ts` | YAML fetching and parsing |
| `src/app/meals/meals.spec.ts` | Meals page, search, tag and unit display |
| `src/app/ingredients/ingredients.spec.ts` | Ingredients page, grouping and sorting |
| `src/app/plan/plan.spec.ts` | Plan generation, replacement and picker logic |

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
