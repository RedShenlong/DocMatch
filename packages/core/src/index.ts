import { browserEnv } from './browser/env';
import { checkDocument } from './check';
import type { Env } from './env';
import { messagesFor } from './i18n';
import { checkProfile, type Profile } from './profile/types';
import type { Options, Result } from './types';
import { MessageUI } from './ui';

export type { Result, Status, Options, Mode, FieldRef } from './types';
export type { Matcher, MatchSignal } from './matchers/types';
export type { Profile, ProfileField, Anchor } from './profile/types';
export type { Env } from './env';
export type { MessageKey } from './i18n';

export const VERSION = '0.1.0';

type ProfileSource = string | Profile;
type FileLike = File | Blob | ArrayBuffer | Uint8Array;

async function toBytes(f: FileLike): Promise<Uint8Array> {
  if (f instanceof Uint8Array) return f;
  if (f instanceof ArrayBuffer) return new Uint8Array(f);
  return new Uint8Array(await (f as Blob).arrayBuffer());
}

function resolveUrl(u: string): string {
  try {
    return new URL(u, typeof document !== 'undefined' ? document.baseURI : undefined).href;
  } catch {
    return u;
  }
}

export interface AttachOptions extends Options {
  profiles: ProfileSource[];
}

export interface Attachment {
  readonly input: HTMLInputElement;
  /** Último resultado (o null si no hay archivo). */
  readonly result: Result | null;
  detach(): void;
}

/**
 * DocMatch: comprueba en el navegador, sin enviar nada a ningún servidor, que un PDF es la plantilla
 * pedida y que tiene los datos obligatorios.
 */
export class DocMatch {
  static readonly version = VERSION;
  /** Entorno por defecto (se puede sustituir en tests o en Node). */
  static env: ((o: Options) => Env) | null = null;

  private constructor(
    readonly profiles: Profile[],
    private readonly opts: Options,
    private readonly env: Env,
  ) {}

  static async load(profiles: ProfileSource[] | ProfileSource, opts: Options = {}): Promise<DocMatch> {
    const env = DocMatch.env ? DocMatch.env(opts) : browserEnv({ assetsPath: opts.assetsPath });
    const list = Array.isArray(profiles) ? profiles : [profiles];
    const loaded = await Promise.all(
      list.map(async (p) => checkProfile(typeof p === 'string' ? await env.fetchJson(resolveUrl(p)) : p)),
    );
    if (!loaded.length) throw new Error('DocMatch: hace falta al menos un perfil');
    return new DocMatch(loaded, opts, env);
  }

  /** Comprueba un archivo. No toca el DOM ni envía datos a ningún sitio. */
  async check(file: FileLike, opts: Options = {}): Promise<Result> {
    const o = { ...this.opts, ...opts };
    try {
      return await checkDocument(await toBytes(file), this.profiles, this.env, o);
    } catch (e) {
      if (o.debug) console.error('[docmatch]', e);
      const m = messagesFor(o.lang, o.messages);
      return {
        status: 'error',
        score: 0,
        missingFields: [],
        invalidFields: [],
        warnings: [],
        messages: [m.error],
        timings: {},
        messageKey: 'error',
      };
    }
  }

  /** Conecta DocMatch a un <input type="file">: muestra el mensaje y emite eventos docmatch:*. */
  static attach(target: string | HTMLInputElement, opts: AttachOptions): Attachment {
    const input = typeof target === 'string' ? document.querySelector<HTMLInputElement>(target) : target;
    if (!input) throw new Error(`DocMatch.attach: no existe ${String(target)}`);
    const lang = opts.lang ?? (input.closest('[lang]')?.getAttribute('lang') || 'es');
    const o: Options = { mode: 'warn', ui: true, ocr: 'auto', ...opts, lang };
    const ui = o.ui !== false ? new MessageUI(input, lang, o.messages) : null;
    const dmP = DocMatch.load(opts.profiles, o);
    let last: Result | null = null;
    let run = 0;
    const emit = (name: string, detail: unknown) =>
      input.dispatchEvent(new CustomEvent(name, { detail, bubbles: true }));
    const onChange = async () => {
      const my = ++run;
      input.setCustomValidity('');
      const files = [...(input.files ?? [])];
      if (!files.length) {
        last = null;
        ui?.clear();
        return;
      }
      ui?.checking();
      emit('docmatch:start', { files: files.map((f) => f.name) });
      try {
        const dm = await dmP;
        const results: Result[] = [];
        for (const f of files) results.push(await dm.check(f));
        if (my !== run) return; // el usuario cambió de archivo mientras se comprobaba
        const order = ['mismatch', 'unreadable', 'incomplete', 'error', 'match'];
        const worst = [...results].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))[0]!;
        const r: Result =
          files.length > 1
            ? {
                ...worst,
                messages: results.flatMap((x, i) => x.messages.map((m) => `${files[i]!.name}: ${m}`)),
              }
            : worst;
        last = r;
        ui?.show(r);
        if (o.mode === 'block' && ['mismatch', 'incomplete', 'unreadable'].includes(r.status))
          input.setCustomValidity(r.messages.join(' '));
        emit('docmatch:result', r);
      } catch (e) {
        if (my !== run) return;
        const m = messagesFor(lang, o.messages);
        const r: Result = {
          status: 'error',
          score: 0,
          missingFields: [],
          invalidFields: [],
          warnings: [],
          messages: [m.error],
          timings: {},
          messageKey: 'error',
        };
        last = r;
        ui?.show(r);
        emit('docmatch:error', { ...r, error: String((e as Error)?.message ?? e) });
      }
    };
    input.addEventListener('change', onChange);
    return {
      input,
      get result() {
        return last;
      },
      detach() {
        input.removeEventListener('change', onChange);
        input.setCustomValidity('');
        ui?.destroy();
      },
    };
  }
}

export default DocMatch;
