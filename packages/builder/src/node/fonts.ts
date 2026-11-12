import { readFileSync } from 'node:fs';
import { FONTS_DIR, HAND_FONT_FILES } from '@docmatch/fixtures/node/fonts';

export function handFontsNode(): Uint8Array[] {
  return HAND_FONT_FILES.map((f) => new Uint8Array(readFileSync(FONTS_DIR + f)));
}
