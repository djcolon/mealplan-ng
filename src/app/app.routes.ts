import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    // Plan is the home page, served at the root path
    path: '',
    loadComponent: () =>
      import('./plan/plan').then((m) => m.PlanComponent),
    title: 'Meal Planner',
  },
  {
    // Keep /plan as an alias that redirects to root
    path: 'plan',
    redirectTo: '',
    pathMatch: 'full',
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
