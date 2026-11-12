import { messagesFor } from './i18n';
import type { Result, Status } from './types';

/** Mensaje discreto y accesible bajo el campo de subida. Sin dependencias; personalizable con CSS. */

const CSS = `
.docmatch-msg{--_c:var(--docmatch-info,#1d4f91);--_bg:var(--docmatch-info-bg,#eef4fb);
font:var(--docmatch-font,inherit);font-size:var(--docmatch-font-size,.9rem);line-height:1.4;color:var(--_c);
background:var(--_bg);border:1px solid currentColor;border-left-width:4px;border-radius:var(--docmatch-radius,6px);
padding:var(--docmatch-padding,.45em .7em);margin:var(--docmatch-margin,.4em 0 0);display:flex;gap:.5em;align-items:flex-start;max-width:var(--docmatch-max-width,42em)}
.docmatch-msg[hidden]{display:none}
.docmatch-msg p{margin:0}
.docmatch-msg [data-icon]{font-weight:700;flex:none}
.docmatch-msg[data-state=match]{--_c:var(--docmatch-ok,#1b6b2f);--_bg:var(--docmatch-ok-bg,#edf7ef)}
.docmatch-msg[data-state=incomplete]{--_c:var(--docmatch-warn,#7a4a00);--_bg:var(--docmatch-warn-bg,#fff6e5)}
.docmatch-msg[data-state=mismatch],.docmatch-msg[data-state=unreadable]{--_c:var(--docmatch-error,#a3172b);--_bg:var(--docmatch-error-bg,#fdeef0)}
.docmatch-msg[data-state=error]{--_c:var(--docmatch-muted,#4a4a4a);--_bg:var(--docmatch-muted-bg,#f3f3f3)}
@media (prefers-reduced-motion:no-preference){.docmatch-msg[data-state=checking] [data-icon]{animation:docmatch-spin 1s linear infinite;display:inline-block}}
@keyframes docmatch-spin{to{transform:rotate(360deg)}}
`;

const ICON: Record<Status | 'checking', string> = {
  checking: '◌',
  match: '✓',
  incomplete: '!',
  mismatch: '✕',
  unreadable: '?',
  error: 'i',
};

let styled = false;
function injectStyle(doc: Document) {
  if (styled || doc.querySelector('style[data-docmatch]')) return;
  const s = doc.createElement('style');
  s.setAttribute('data-docmatch', '');
  s.textContent = CSS;
  (doc.head ?? doc.documentElement).appendChild(s);
  styled = true;
}

let uid = 0;

export class MessageUI {
  readonly el: HTMLElement;
  constructor(
    private input: HTMLInputElement,
    private lang: string,
    private custom?: Partial<Record<string, string>>,
  ) {
    const doc = input.ownerDocument;
    injectStyle(doc);
    this.el = doc.createElement('div');
    this.el.className = 'docmatch-msg';
    this.el.id = `docmatch-msg-${++uid}`;
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.hidden = true;
    input.insertAdjacentElement('afterend', this.el);
    const prev = input.getAttribute('aria-describedby');
    input.setAttribute('aria-describedby', prev ? `${prev} ${this.el.id}` : this.el.id);
  }

  private render(state: Status | 'checking', lines: string[]) {
    const doc = this.el.ownerDocument;
    this.el.dataset.state = state;
    this.el.replaceChildren();
    const icon = doc.createElement('span');
    icon.setAttribute('data-icon', '');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = ICON[state];
    const body = doc.createElement('div');
    for (const l of lines) {
      const p = doc.createElement('p');
      p.textContent = l;
      body.appendChild(p);
    }
    this.el.append(icon, body);
    this.el.hidden = false;
  }

  checking() {
    this.render('checking', [messagesFor(this.lang, this.custom).checking]);
  }
  show(r: Result) {
    this.render(r.status, r.messages);
  }
  clear() {
    this.el.hidden = true;
    this.el.replaceChildren();
    delete this.el.dataset.state;
  }
  destroy() {
    this.el.remove();
    const ids = (this.input.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter((x) => x && x !== this.el.id);
    if (ids.length) this.input.setAttribute('aria-describedby', ids.join(' '));
    else this.input.removeAttribute('aria-describedby');
  }
}
