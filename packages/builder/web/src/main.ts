import { browserEnv } from 'docmatch/browser';
import { openPdf, renderPage, type Profile } from 'docmatch/internal';
import { buildProfile, type BuildResult } from '../../src/lib/profile';
import type { ProposedField } from '../../src/lib/propose';
import { inferType, slugify } from '../../src/lib/propose';
import { validateProfile } from '../../src/lib/schema';
import { trainVisual } from '../../src/lib/visual';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const env = browserEnv({ assetsPath: new URL('./assets/', document.baseURI).href });
const TYPES = [
  'text',
  'date',
  'dni_nie',
  'nif_cif',
  'iban',
  'email',
  'phone',
  'number',
  'postal_code',
  'checkbox',
  'signature',
];
const HAND_FONTS = [
  'indieflower/IndieFlower-Regular.ttf',
  'reeniebeanie/ReenieBeanie.ttf',
  'shadowsintolight/ShadowsIntoLight.ttf',
  'homemadeapple/HomemadeApple-Regular.ttf',
];

let template: Uint8Array | null = null;
let fields: ProposedField[] = [];
let built: BuildResult | null = null;
let pages: HTMLCanvasElement[] = [];
let page = 0;
let selected = -1;
let drawing = false;

const fileBytes = async (f: File) => new Uint8Array(await f.arrayBuffer());

async function renderPreview(bytes: Uint8Array) {
  const pdf = await openPdf(bytes, env);
  pages = [];
  for (let i = 1; i <= pdf.numPages; i++)
    pages.push((await renderPage(await pdf.getPage(i), 1.5, env)) as HTMLCanvasElement);
  await pdf.destroy();
  const sel = $<HTMLSelectElement>('page');
  sel.replaceChildren(...pages.map((_, i) => new Option(String(i + 1), String(i))));
  sel.onchange = () => {
    page = Number(sel.value);
    draw();
  };
}

function draw() {
  const pv = $<HTMLCanvasElement>('pv');
  const ov = $<HTMLCanvasElement>('ov');
  const src = pages[page];
  if (!src) return;
  pv.width = ov.width = src.width;
  pv.height = ov.height = src.height;
  pv.getContext('2d')!.drawImage(src, 0, 0);
  const ctx = ov.getContext('2d')!;
  ctx.clearRect(0, 0, ov.width, ov.height);
  fields.forEach((f, i) => {
    if (f.page !== page) return;
    ctx.strokeStyle = i === selected ? '#a3172b' : f.required ? '#1d4f91' : '#2e7d32';
    ctx.lineWidth = i === selected ? 4 : 2;
    ctx.strokeRect(f.box.x * ov.width, f.box.y * ov.height, f.box.w * ov.width, f.box.h * ov.height);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = '14px system-ui';
    ctx.fillText(f.key, f.box.x * ov.width + 2, f.box.y * ov.height - 3);
  });
}

function renderRows() {
  const tb = $('rows');
  tb.replaceChildren();
  fields.forEach((f, i) => {
    const tr = document.createElement('tr');
    if (i === selected) tr.className = 'sel';
    const key = Object.assign(document.createElement('input'), { type: 'text', value: f.key });
    key.setAttribute('aria-label', 'Clave');
    key.onchange = () => (f.key = slugify(key.value));
    const lab = Object.assign(document.createElement('input'), { type: 'text', value: f.label });
    lab.setAttribute('aria-label', 'Etiqueta');
    lab.onchange = () => (f.label = lab.value);
    const typ = document.createElement('select');
    typ.setAttribute('aria-label', 'Tipo');
    typ.append(...TYPES.map((t) => new Option(t, t, false, t === f.type)));
    typ.onchange = () => (f.type = typ.value as ProposedField['type']);
    const req = Object.assign(document.createElement('input'), { type: 'checkbox', checked: f.required });
    req.setAttribute('aria-label', 'Obligatorio');
    req.onchange = () => {
      f.required = req.checked;
      draw();
    };
    const del = Object.assign(document.createElement('button'), {
      type: 'button',
      textContent: '✕',
      title: 'Eliminar campo',
    });
    del.setAttribute('aria-label', `Eliminar ${f.key}`);
    del.onclick = () => {
      fields.splice(i, 1);
      selected = -1;
      renderRows();
      draw();
    };
    const cells = [key, lab, typ, req, del].map((el) => {
      const td = document.createElement('td');
      td.appendChild(el);
      return td;
    });
    tr.append(...cells);
    tr.onfocusin = tr.onclick = () => {
      selected = i;
      if (f.page !== page) {
        page = f.page;
        $<HTMLSelectElement>('page').value = String(page);
      }
      [...tb.children].forEach((r, k) => r.classList.toggle('sel', k === i));
      draw();
    };
    tb.appendChild(tr);
  });
}

// Dibujar un rectángulo para añadir un campo.
let start: { x: number; y: number } | null = null;
const rel = (e: PointerEvent) => {
  const r = $<HTMLCanvasElement>('ov').getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
};
$<HTMLCanvasElement>('ov').addEventListener('pointerdown', (e) => {
  if (!drawing) return;
  start = rel(e);
});
$<HTMLCanvasElement>('ov').addEventListener('pointerup', (e) => {
  if (!drawing || !start) return;
  const end = rel(e);
  const box = {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  };
  start = null;
  if (box.w < 0.01 || box.h < 0.005) return;
  const label = `Campo ${fields.length + 1}`;
  fields.push({
    key: slugify(label),
    label,
    type: inferType(label),
    required: true,
    page,
    box,
    source: 'manual',
  });
  selected = fields.length - 1;
  drawing = false;
  $('add').setAttribute('aria-pressed', 'false');
  renderRows();
  draw();
});
$('add').onclick = () => {
  drawing = !drawing;
  $('add').setAttribute('aria-pressed', String(drawing));
};

$('analyze').onclick = async () => {
  const f = $<HTMLInputElement>('tpl').files?.[0];
  if (!f) return alertText('Elige la plantilla vacía en PDF.');
  $('status').textContent = '';
  template = await fileBytes(f);
  const examples = await Promise.all([...($<HTMLInputElement>('ex').files ?? [])].slice(0, 3).map(fileBytes));
  built = await buildProfile(template, env, {
    id: $<HTMLInputElement>('pid').value || undefined,
    name: $<HTMLInputElement>('pname').value || undefined,
    issuer: $<HTMLInputElement>('pissuer').value || undefined,
    examples,
    expect: {
      csv: $<HTMLInputElement>('xcsv').checked,
      digitalSignature: $<HTMLInputElement>('xsig').checked,
    },
    edit: (fs) => fs,
  });
  fields = built.fields.map((x) => ({ ...x }));
  $('warnings').replaceChildren(
    ...built.warnings.map((w) => Object.assign(document.createElement('p'), { textContent: w })),
  );
  await renderPreview(template);
  page = 0;
  selected = -1;
  renderRows();
  draw();
  $('sec2').hidden = false;
  $('sec3').hidden = false;
};

function alertText(t: string) {
  $('warnings').replaceChildren(Object.assign(document.createElement('p'), { textContent: t }));
}

$('build').onclick = async () => {
  if (!template || !built) return;
  const btn = $<HTMLButtonElement>('build');
  btn.disabled = true;
  const prog = $<HTMLProgressElement>('prog');
  prog.hidden = false;
  try {
    // Se rehace el perfil con los campos revisados por el dueño.
    const { profile } = await buildProfile(template, env, {
      id: $<HTMLInputElement>('pid').value || undefined,
      name: $<HTMLInputElement>('pname').value || undefined,
      issuer: $<HTMLInputElement>('pissuer').value || undefined,
      expect: {
        csv: $<HTMLInputElement>('xcsv').checked,
        digitalSignature: $<HTMLInputElement>('xsig').checked,
      },
      edit: () => fields,
    });
    const fonts = await Promise.all(
      HAND_FONTS.map(async (f) => new Uint8Array(await (await fetch(`./fonts/${f}`)).arrayBuffer())),
    );
    const engine = await env.vision!();
    if (!engine) $('status').textContent = 'Modelo visual no disponible: se calibran solo texto y tinta.';
    const rep = await trainVisual(template, profile, env, engine, {
      handFonts: fonts,
      onProgress: (m, f) => {
        prog.value = f;
        $('status').textContent = `${m}…`;
      },
    });
    const errs = validateProfile(profile);
    if (errs.length) throw new Error(`El perfil no cumple el esquema: ${errs.join('; ')}`);
    showReport(profile, rep.estimatedAccuracy, rep);
    const blob = new Blob([JSON.stringify(profile)], { type: 'application/json' });
    const a = $<HTMLAnchorElement>('dl');
    a.href = URL.createObjectURL(blob);
    a.download = `${profile.id}.json`;
    a.hidden = false;
    $('status').textContent =
      `Perfil listo (${(blob.size / 1024).toFixed(0)} KB, ${rep.seconds.toFixed(0)} s).`;
  } catch (e) {
    $('status').textContent = `Error: ${(e as Error).message}`;
  } finally {
    btn.disabled = false;
  }
};

function showReport(p: Profile, acc: number, rep: Awaited<ReturnType<typeof trainVisual>>) {
  const pct = (v: number) => `${(v * 100).toFixed(1)} %`;
  const rows: [string, string][] = [
    ['Precisión estimada', pct(acc)],
    ['Falsos positivos (escaneos)', pct(rep.fusion.scan.fpr)],
    ['Falsos negativos (escaneos)', pct(rep.fusion.scan.fnr)],
    ['Falsos positivos (PDF digital)', pct(rep.fusion.digital.fpr)],
    ['Campos: rellenos tomados por vacíos (falso «falta»)', pct(rep.fields.fnr)],
    ['Campos: vacíos tomados por rellenos', pct(rep.fields.fpr)],
    ['Variantes sintéticas', `${rep.positives} positivas, ${rep.negatives} negativas`],
    [
      'Modelo visual',
      p.visual?.modelId !== 'none' ? `${p.visual?.modelId} ${p.visual?.modelVersion}` : 'no disponible',
    ],
  ];
  const t = document.createElement('table');
  for (const [k, v] of rows) {
    const tr = t.insertRow();
    tr.insertCell().textContent = k;
    tr.insertCell().textContent = v;
  }
  $('report').replaceChildren(
    Object.assign(document.createElement('h3'), { textContent: `Precisión estimada: ${pct(acc)}` }),
    t,
  );
}
