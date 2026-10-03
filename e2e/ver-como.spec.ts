import { test, expect } from '@playwright/test';

// "Ver como" con los datos demo (seed del núcleo + supabase/seed/datos_prueba.sql):
// Carolina es owner de TI en Comercial Andes y mira la app como Pablo (agente de Soporte), en solo lectura.
// Contraseña de las cuentas demo en DEMO_PASS.
const PASS = process.env.DEMO_PASS ?? '';
test.skip(!PASS, 'Falta DEMO_PASS');

test('la owner ve la app como un agente, en solo lectura, y vuelve a su vista', async ({ page }) => {
  const errores: string[] = [];
  page.on('pageerror', e => errores.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errores.push(m.text()); });

  await page.goto('/');
  await page.locator('#email').fill('carolina@demo.test');
  await page.locator('#pass').fill(PASS);
  await page.locator('#loginBtn').click();
  await expect(page.getByRole('heading', { name: 'Inicio', level: 1 })).toBeVisible();

  // Empresa y workspace en la barra lateral (con una sola opción no hay selector)
  for (const [caja, opcion] of [['#empSel', 'Comercial Andes'], ['#wsSel', 'TI']]) {
    const selector = page.locator(`${caja} .nx-pick__btn`);
    if (await selector.count() && !(await selector.textContent())?.includes(opcion)) {
      await selector.click();
      await page.getByRole('option', { name: opcion }).click();
    }
  }

  const menu = page.getByRole('navigation');
  await menu.getByText('Gestión').click();
  await menu.getByRole('link', { name: 'Ver como' }).click();
  await expect(page.getByRole('heading', { name: 'Ver como', level: 1 })).toBeVisible();

  // Agrupadas por rol
  const persona = page.getByLabel('Ver la app como');
  await expect(persona.locator('optgroup[label="Agente"] option', { hasText: 'Pablo Fuentes' })).toHaveCount(1);
  await expect(persona.locator('optgroup[label="Supervisor"] option', { hasText: 'Diego Rojas' })).toHaveCount(1);
  await persona.selectOption({ label: 'Pablo Fuentes' });
  await page.getByRole('button', { name: 'Ver como' }).click();

  await expect(page.locator('#comoBanner')).toContainText('Pablo Fuentes');
  await expect(page.getByRole('heading', { name: 'Inicio', level: 1 })).toBeVisible();
  await expect(page.locator('#bajada')).toContainText('Mi cola de trabajo');
  await expect(page.getByRole('button', { name: 'Nuevo ticket' })).toHaveCount(0);
  await expect(menu.getByText('Configuración del workspace')).toHaveCount(0);
  await expect(menu.getByText('Administración')).toHaveCount(0);
  await page.screenshot({ path: 'e2e/capturas/6-ver-como.png', fullPage: true });

  await page.getByRole('button', { name: 'Volver a mi vista' }).click();
  await expect(page.locator('#comoBanner')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Ver como', level: 1 })).toBeVisible();
  await expect(menu.getByText('Configuración del workspace')).toHaveCount(1);
  expect(errores).toEqual([]);
});
