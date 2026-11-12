/**
 * Integración declarativa: <script src="docmatch.min.js" defer></script> y
 * <input type="file" data-docmatch="/perfiles/a.json,/perfiles/b.json">.
 * Atributos opcionales: data-docmatch-mode="warn|block", data-docmatch-lang, data-docmatch-ocr="off",
 * data-docmatch-assets="/ruta/assets/", data-docmatch-ui="false".
 */
import { DocMatch, type Attachment } from './index';

const attached = new WeakMap<HTMLInputElement, Attachment>();

function attachInput(input: HTMLInputElement) {
  if (attached.has(input)) return;
  const d = input.dataset;
  const profiles = (d.docmatch ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!profiles.length) return;
  try {
    attached.set(
      input,
      DocMatch.attach(input, {
        profiles,
        mode: d.docmatchMode === 'block' ? 'block' : 'warn',
        lang: d.docmatchLang,
        ocr: d.docmatchOcr === 'off' ? 'off' : 'auto',
        assetsPath: d.docmatchAssets,
        ui: d.docmatchUi !== 'false',
      }),
    );
  } catch (e) {
    console.warn('[docmatch]', e);
  }
}

function scan(root: ParentNode = document): void {
  root.querySelectorAll<HTMLInputElement>('input[type=file][data-docmatch]').forEach(attachInput);
}

if (typeof document !== 'undefined') {
  const start = () => {
    scan();
    new MutationObserver((muts) => {
      for (const m of muts)
        m.addedNodes.forEach(
          (n) =>
            n instanceof Element &&
            (n.matches('input[type=file][data-docmatch]') ? attachInput(n as HTMLInputElement) : scan(n)),
        );
    }).observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}

/** En la versión <script>, window.DocMatch es la clase; DocMatch.scan() vuelve a buscar inputs. */
(DocMatch as unknown as { scan: typeof scan }).scan = scan;
export default DocMatch;
