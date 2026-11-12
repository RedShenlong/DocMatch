import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setHandFonts } from '../render';

export const FONTS_DIR = fileURLToPath(new URL('../../fonts/', import.meta.url));
export const HAND_FONT_FILES = [
  'indieflower/IndieFlower-Regular.ttf',
  'reeniebeanie/ReenieBeanie.ttf',
  'shadowsintolight/ShadowsIntoLight.ttf',
  'homemadeapple/HomemadeApple-Regular.ttf',
];

export function loadHandFonts(): void {
  setHandFonts(HAND_FONT_FILES.map((f) => new Uint8Array(readFileSync(FONTS_DIR + f))));
}
