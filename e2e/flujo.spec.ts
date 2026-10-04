import { test, expect, Page, Browser } from '@playwright/test';

// Flujo completo con tres roles sobre una empresa de prueba con plan Básica (2 agentes):
// el admin arma el workspace, Ana abre un ticket, el agente lo atiende y Ana confirma la solución.
// Cuentas: te-admin / te-agente / te-ana @e2e.test, contraseña en TE_PASS.
const PASS = process.env.TE_PASS ?? '';
const corrida = Date.now().toString(36);
const WS = `TI ${corrida}`;
const ASUNTO = `No abre App-A (${corrida})`;
const capturas = 'e2e/capturas';

test.describe.configure({ mode: 'serial' });
test.skip(!PASS, 'Falta TE_PASS');

async function entrar(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', e => { throw e; });
  await page.goto('/');
  await page.locator('#email').fill(email);
  await page.locator('#pass').fill(PASS);
  await page.locator('#loginBtn').click();
  await expect(page.getByRole('heading', { name: 'Inicio', level: 1 })).toBeVisible();
  return page;
}
// El workspace se elige en la barra lateral (con uno solo no hay selector)
async function enWorkspace(page: Page) {
  const selector = page.locator('#wsSel .nx-pick__btn');
  if (!await selector.count()) return;
  await selector.click();
  await page.getByRole('option', { name: WS }).click();
}
// Las opciones del árbol van indentadas: se elige por texto y se usa su value
async function elegir(page: Page, label: string, texto: string) {
  const select = page.getByLabel(label, { exact: false });
  const valor = await select.locator('option', { hasText: texto }).first().getAttribute('value');
  await select.selectOption(valor!);
}

test('el admin crea el workspace, sus categorías, un formulario y el equipo', async ({ browser }) => {
  const page = await entrar(browser, 'te-admin@e2e.test');
  const menu = page.getByRole('navigation');
  // Nuevo workspace: última opción del selector de la barra lateral (sin workspaces, el botón de Inicio)
  const selectorWs = page.locator('#wsSel .nx-pick__btn');
  if (await selectorWs.count()) {
    await selectorWs.click();
    await page.getByRole('option', { name: 'Nuevo workspace' }).click();
  } else {
    await page.getByRole('link', { name: 'Nuevo workspace' }).click();
  }
  await page.getByLabel('Nombre').fill(WS);
  await page.getByRole('button', { name: 'Crear workspace' }).click();
  await expect(page.locator('#eyebrow')).toHaveText(`Configuración · ${WS}`);

  // Árbol: Desarrollo / Apps
  await page.getByPlaceholder('Nueva categoría principal').fill('Desarrollo');
  await page.locator('.nx-row', { has: page.getByPlaceholder('Nueva categoría principal') }).getByRole('button', { name: 'Agregar' }).click();
  await page.getByPlaceholder('Nueva subcategoría de Desarrollo').fill('Apps');
  await page.locator('.nx-row', { has: page.getByPlaceholder('Nueva subcategoría de Desarrollo') }).getByRole('button', { name: 'Agregar' }).click();
  await page.locator('.nx-tree').getByRole('button', { name: 'Apps' }).click();
  await expect(page.getByText('Usa el formulario del sistema')).toBeVisible();

  // Formulario propio de Apps: lista obligatoria
  await page.getByRole('button', { name: 'Agregar campo' }).click();
  const dlg = page.locator('#dlg');
  await dlg.getByLabel('Etiqueta').fill('Aplicación');
  await dlg.getByLabel('Tipo').selectOption({ label: 'Lista' });
  await dlg.getByText('Obligatorio').click();
  await dlg.getByLabel('Opciones').fill('App-A\nApp-B');
  await dlg.getByRole('button', { name: 'Agregar campo' }).click();
  await expect(page.locator('.nx-preview').getByText('Aplicación')).toBeVisible();
  await page.screenshot({ path: `${capturas}/1-editor-plantillas.png`, fullPage: true });

  // Equipo: el agente atiende la rama Apps
  await menu.getByRole('link', { name: 'Equipo', exact: true }).click();
  await page.getByLabel('Persona').selectOption({ label: 'Agente E2E' });
  await elegir(page, 'Alcance', 'Apps');
  await page.getByRole('button', { name: 'Agregar' }).click();
  await expect(page.getByText('Agente · Desarrollo / Apps')).toBeVisible();
  await page.screenshot({ path: `${capturas}/2-equipo.png`, fullPage: true });
});

test('Ana abre un ticket en Apps con el formulario dinámico', async ({ browser }) => {
  const page = await entrar(browser, 'te-ana@e2e.test');
  await enWorkspace(page);
  await page.getByRole('button', { name: 'Nuevo ticket' }).first().click();
  const dlg = page.locator('#dlg');
  await elegir(page, 'Categoría', 'Apps');
  const app = dlg.locator('.nx-field', { hasText: 'Aplicación' }).locator('select');
  await expect(app).toBeVisible();
  await dlg.getByLabel('Asunto').fill(ASUNTO);
  await dlg.locator('.ql-editor').fill('Desde hoy en la mañana la aplicación queda en blanco.');

  // El campo obligatorio se valida antes de enviar
  await dlg.getByRole('button', { name: 'Crear ticket' }).click();
  await expect(dlg).toBeVisible();
  await app.selectOption('App-A');
  await page.screenshot({ path: `${capturas}/3-nuevo-ticket.png` });
  await dlg.getByRole('button', { name: 'Crear ticket' }).click();
  await expect(page.getByRole('button', { name: ASUNTO })).toBeVisible();
});

test('el agente de Apps lo ve, lo atiende, responde y lo resuelve', async ({ browser }) => {
  const page = await entrar(browser, 'te-agente@e2e.test');
  await enWorkspace(page);
  await page.getByRole('button', { name: ASUNTO }).click();
  const dlg = page.locator('#dlg');
  await expect(dlg.locator('dd', { hasText: 'App-A' })).toBeVisible();
  await dlg.getByRole('button', { name: 'Clasificar' }).click();
  await dlg.getByRole('button', { name: 'Atender' }).click();
  await expect(dlg.getByText('Atiende Agente E2E')).toBeVisible();

  await dlg.locator('.nx-seg .ql-editor').fill('Reinstalamos la app; ya debería abrir.');
  await dlg.getByRole('button', { name: 'Enviar' }).click();
  await expect(dlg.getByText('Reinstalamos la app; ya debería abrir.')).toBeVisible();
  await dlg.getByRole('button', { name: 'Marcar resuelto' }).click();
  await expect(dlg.locator('.nx-chips').getByText('Resuelto')).toBeVisible();
  await page.screenshot({ path: `${capturas}/4-detalle-agente.png` });
});

test('Ana ve la respuesta con el rol del agente y confirma la solución', async ({ browser }) => {
  const page = await entrar(browser, 'te-ana@e2e.test');
  await enWorkspace(page);
  await page.getByRole('button', { name: ASUNTO }).click();
  const dlg = page.locator('#dlg');
  await expect(dlg.locator('.nx-seg__meta', { hasText: 'Agente E2E · Agente' }).first()).toBeVisible();
  await expect(dlg.getByText('Nota interna')).toHaveCount(0);
  await dlg.getByRole('button', { name: 'Sí, cerrar ticket' }).click();
  await expect(dlg.locator('.nx-chips').getByText('Cerrado')).toBeVisible();
  await page.screenshot({ path: `${capturas}/5-cerrado-solicitante.png` });
});
