import {
  ApplicationConfig,
  isDevMode,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(),
    // Register the Angular service worker in production only.
    // In development mode (ng serve) the SW is intentionally disabled so
    // that code changes are always reflected without a cache-busting step.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      // Wait until the app is stable before registering, to avoid
      // delaying the initial render on slow connections.
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
