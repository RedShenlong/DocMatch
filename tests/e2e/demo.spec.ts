import { expect, test, type Page, type Request } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const S = (f: string) => fileURLToPath(new URL(`../../packages/fixtures/out/cases/${f}`, import.meta.url));
const msg = (page: Page, id: string) => page.locator(`#${id} + .docmatch-msg`);

test.beforeEach(async ({ page }) => {
  await page.goto('./');
});

test('integración con un atributo: documento correcto', async ({ page }) => {
  await page.setInputFiles('#lic', S('lic-rellena-11.pdf'));
  await expect(msg(page, 'lic')).toHaveAttribute('data-state', 'match');
  await expect(msg(page, 'lic')).toContainText('Documento correcto');
});

test('faltan datos', async ({ page }) => {
  await page.setInputFiles('#lic', S('lic-sin-dni.pdf'));
  await expect(msg(page, 'lic')).toHaveAttribute('data-state', 'incomplete');
  await expect(msg(page, 'lic')).toContainText('Al documento le faltan datos: DNI/NIE');
});

test('datos inválidos', async ({ page }) => {
  await page.setInputFiles('#lic', S('lic-dni-y-fecha-invalidos.pdf'));
  await expect(msg(page, 'lic')).toHaveAttribute('data-state', 'incomplete');
  await expect(msg(page, 'lic')).toContainText('la letra no corresponde al número');
});

test('documento distinto (formulario primo y factura)', async ({ page }) => {
  await page.setInputFiles('#lic', S('primo-rellena.pdf'));
  await expect(msg(page, 'lic')).toHaveAttribute('data-state', 'mismatch');
  await expect(msg(page, 'lic')).toContainText('No parece el documento solicitado');
  await page.setInputFiles('#lic', S('ajeno-factura.pdf'));
  await expect(msg(page, 'lic')).toHaveAttribute('data-state', 'mismatch');
});

test('PDF protegido y archivo que no es PDF', async ({ page }) => {
  await page.setInputFiles('#lic', S('especial-cifrado.pdf'));
  await expect(msg(page, 'lic')).toHaveAttribute('data-state', 'unreadable');
  await expect(msg(page, 'lic')).toContainText('contraseña');
  await page.setInputFiles('#lic', S('especial-no-es-pdf.pdf'));
  await expect(msg(page, 'lic')).toContainText('no es un PDF');
});

test('modo avisar: nunca impide enviar', async ({ page }) => {
  await page.setInputFiles('#lic', S('ajeno-factura.pdf'));
  await expect(msg(page, 'lic')).toHaveAttribute('data-state', 'mismatch');
  await page.locator('#f1 button[type=submit]').click();
  await expect(page.locator('#sent')).toContainText('enviado');
});

test('modo bloquear: setCustomValidity y varias plantillas válidas', async ({ page }) => {
  await page.setInputFiles('#emp', S('emp-input-con-licencia.pdf'));
  await expect(msg(page, 'emp')).toHaveAttribute('data-state', 'mismatch');
  expect(await page.$eval('#emp', (el: HTMLInputElement) => el.validity.customError)).toBe(true);
  await page.setInputFiles('#emp', S('emp-b-emitido.pdf'));
  await expect(msg(page, 'emp')).toHaveAttribute('data-state', 'match');
  expect(await page.$eval('#emp', (el: HTMLInputElement) => el.validity.valid)).toBe(true);
});

test('aviso de firma electrónica y CSV', async ({ page }) => {
  await page.setInputFiles('#emp', S('emp-a-sin-csv-ni-firma.pdf'));
  await expect(msg(page, 'emp')).toHaveAttribute('data-state', 'match');
  await expect(msg(page, 'emp')).toContainText('firma electrónica');
  await expect(msg(page, 'emp')).toContainText('Código Seguro de Verificación');
});

test('accesibilidad del mensaje y vaciado al quitar el archivo', async ({ page }) => {
  await page.setInputFiles('#lic', S('lic-rellena-11.pdf'));
  const m = msg(page, 'lic');
  await expect(m).toHaveAttribute('role', 'status');
  await expect(m).toHaveAttribute('aria-live', 'polite');
  const id = await m.getAttribute('id');
  await expect(page.locator('#lic')).toHaveAttribute('aria-describedby', new RegExp(id!));
  await expect(m).toHaveAttribute('data-state', 'match');
  await page.setInputFiles('#lic', []);
  await expect(m).toBeHidden();
});

test('API programática y eventos', async ({ page }) => {
  await page.setInputFiles('#api', S('lic-sin-dni.pdf'));
  await expect(page.locator('#log')).toContainText('"status": "incomplete"');
  await page.setInputFiles('#lic', S('lic-rellena-12.pdf'));
  await expect(page.locator('#log')).toContainText('[event] docmatch:result #lic: match');
});

test('privacidad: durante check() no sale nada del dispositivo', async ({ page, baseURL }) => {
  const reqs: Request[] = [];
  page.on('request', (r) => reqs.push(r));
  await page.setInputFiles('#lic', S('scan-lic-rellena-41.pdf'));
  await expect(msg(page, 'lic')).toHaveAttribute('data-state', /match|incomplete|mismatch|unreadable/, {
    timeout: 110_000,
  });
  const origin = new URL(baseURL!).origin;
  const allowed = /\/(docmatch\/(docmatch\.min\.js|assets\/.*)|profiles\/[^/]+\.json|favicon\.ico)$/;
  for (const r of reqs) {
    const u = new URL(r.url());
    if (u.protocol === 'blob:' || u.protocol === 'data:') continue;
    expect(u.origin, `petición a otro origen: ${r.url()}`).toBe(origin);
    expect(r.method(), `método no permitido: ${r.url()}`).toBe('GET');
    expect(r.postData()).toBeFalsy();
    expect(u.pathname, `recurso no permitido: ${u.pathname}`).toMatch(allowed);
  }
});

test('escaneo (OCR en el navegador)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'El OCR es lento: se prueba en Chromium (escritorio y móvil).');
  await page.setInputFiles('#lic', S('scan-lic-rellena-41.pdf'));
  await expect(msg(page, 'lic')).toHaveAttribute('data-state', 'match', { timeout: 110_000 });
});
