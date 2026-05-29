import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    // Redirect the root path to /plan so the plan is the default view
    path: '',
    redirectTo: 'plan',
    pathMatch: 'full',
  },
  {
    path: 'plan',
    loadComponent: () =>
      import('./plan/plan').then((m) => m.PlanComponent),
    title: 'Plan – Meal Planner',
  },
  {
    path: 'meals',
    loadComponent: () =>
      import('./meals/meals').then((m) => m.MealsComponent),
    title: 'Meals – Meal Planner',
  },
  {
    path: 'ingredients',
    loadComponent: () =>
      import('./ingredients/ingredients').then(
        (m) => m.IngredientsComponent,
      ),
    title: 'Ingredients – Meal Planner',
  },
  {
    path: 'shopping-list',
    loadComponent: () =>
      import('./shopping-list/shopping-list').then(
        (m) => m.ShoppingListComponent,
      ),
    title: 'Shopping List – Meal Planner',
  },
];
