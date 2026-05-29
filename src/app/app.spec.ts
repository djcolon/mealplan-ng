import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';

/**
 * Smoke tests for the root App component.
 *
 * These tests verify that the shell (navbar + router outlet) renders
 * correctly. Feature-level behaviour is covered in the individual
 * component spec files.
 */
describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      // Router is required by RouterLink / RouterLinkActive / RouterOutlet
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('creates the root component', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders a navbar element', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('nav.navbar')).not.toBeNull();
  });

  it('shows the app brand name in the navbar', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const brand = (fixture.nativeElement as HTMLElement)
      .querySelector('.navbar-brand');
    expect(brand?.textContent).toContain('Meal Planner');
  });

  it('includes a router-outlet inside the main element', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('main router-outlet')).not.toBeNull();
  });

  it('has a nav link for the Plan page', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    const links = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '.navbar-nav .nav-link',
      ),
    );
    const hrefs = links
      .map((l) => l.getAttribute('href') ?? l.textContent?.trim())
      .filter(Boolean);
    expect(hrefs.some((h) => h?.includes('plan'))).toBe(true);
  });
});

