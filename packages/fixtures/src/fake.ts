import { Rng } from './rng';

/** Datos personales 100 % ficticios para rellenar fixtures. */

const NOMBRES = [
  'Lucía',
  'Martín',
  'Sofía',
  'Hugo',
  'Paula',
  'Daniel',
  'Carmen',
  'Javier',
  'Elena',
  'Pablo',
  'Marta',
  'Álvaro',
  'Nuria',
  'Sergio',
  'Irene',
  'Raúl',
  'Alba',
  'Diego',
  'Rocío',
  'Andrés',
];
const APELLIDOS = [
  'García',
  'Fernández',
  'López',
  'Martínez',
  'Sánchez',
  'Pérez',
  'Gómez',
  'Ruiz',
  'Díaz',
  'Moreno',
  'Muñoz',
  'Álvarez',
  'Romero',
  'Navarro',
  'Torres',
  'Domínguez',
  'Vázquez',
  'Ramos',
  'Gil',
  'Serrano',
];
const CALLES = [
  'Calle Mayor',
  'Avenida del Ejemplo',
  'Plaza de la Prueba',
  'Calle Ficticia',
  'Paseo de los Datos',
  'Calle Imaginaria',
  'Ronda de Muestra',
  'Camino Simulado',
];
const MUNICIPIOS = [
  'Villaejemplo',
  'Pruebadelrío',
  'Muestrilla',
  'San Ficticio',
  'Valdedatos',
  'Torremodelo',
  'Castilprueba',
  'Fuentesimulada',
];
const PROVINCIAS = ['Provincia de Ejemplo', 'Provincia Ficticia', 'Provincia de Muestra'];

export const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

export function dni(r: Rng, valid = true): string {
  const n = r.int(10000000, 99999999);
  let letter = DNI_LETTERS[n % 23] as string;
  if (!valid) letter = DNI_LETTERS[(n + r.int(1, 22)) % 23] as string;
  return `${n}${letter}`;
}

export function nie(r: Rng): string {
  const p = r.int(0, 2);
  const n = r.int(1000000, 9999999);
  const num = Number(`${p}${n}`);
  return `${'XYZ'[p]}${n}${DNI_LETTERS[num % 23]}`;
}

function mod97(s: string): number {
  let rem = 0;
  for (const ch of s) rem = (rem * 10 + Number(ch)) % 97;
  return rem;
}

export function iban(r: Rng): string {
  let bban = '';
  for (let i = 0; i < 20; i++) bban += r.int(0, 9);
  const check = 98 - mod97(bban + '142800'); // E=14 S=28
  const full = `ES${String(check).padStart(2, '0')}${bban}`;
  return full.replace(/(.{4})/g, '$1 ').trim();
}

/** CIF ficticio con dígito de control correcto. */
export function cif(r: Rng): string {
  const letter = r.pick(['A', 'B', 'G', 'P', 'Q', 'S']);
  let digits = '';
  for (let i = 0; i < 7; i++) digits += r.int(0, 9);
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const d = Number(digits[i]);
    if (i % 2 === 0) {
      const x = d * 2;
      sum += Math.floor(x / 10) + (x % 10);
    } else sum += d;
  }
  const ctrl = (10 - (sum % 10)) % 10;
  const ctrlChar = 'PQS'.includes(letter) ? 'JABCDEFGHI'[ctrl] : String(ctrl);
  return `${letter}${digits}${ctrlChar}`;
}

export function date(r: Rng, valid = true): string {
  if (!valid) return `${r.int(32, 39)}/${String(r.int(13, 19))}/${r.int(1950, 2005)}`;
  const y = r.int(1950, 2005);
  const m = r.int(1, 12);
  const d = r.int(1, 28);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

export function phone(r: Rng): string {
  return `${r.pick(['6', '7', '9'])}${r.int(10, 99)} ${r.int(100, 999)} ${r.int(100, 999)}`;
}

export function person(r: Rng) {
  const nombre = r.pick(NOMBRES);
  const ap1 = r.pick(APELLIDOS);
  const ap2 = r.pick(APELLIDOS);
  const user = `${nombre}.${ap1}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return {
    nombre,
    apellidos: `${ap1} ${ap2}`,
    nombreCompleto: `${nombre} ${ap1} ${ap2}`,
    email: `${user}${r.int(1, 99)}@correo.example`,
    domicilio: `${r.pick(CALLES)}, ${r.int(1, 120)}`,
    municipio: r.pick(MUNICIPIOS),
    provincia: r.pick(PROVINCIAS),
    cp: `${r.pick(['01', '08', '28', '41', '46', '50'])}${String(r.int(0, 999)).padStart(3, '0')}`,
  };
}

/** Genera un valor ficticio plausible para un tipo de campo. */
export function valueFor(type: string, key: string, r: Rng, p = person(r)): string {
  switch (type) {
    case 'dni_nie':
      return r.bool(0.85) ? dni(r) : nie(r);
    case 'nif_cif':
      return cif(r);
    case 'iban':
      return iban(r);
    case 'date':
      return date(r);
    case 'email':
      return p.email;
    case 'phone':
      return phone(r);
    case 'postal_code':
      return p.cp;
    case 'number':
      return String(r.int(1, 9999));
    case 'checkbox':
      return 'X';
    case 'signature':
      return '';
    default:
      if (/apellido/.test(key)) return p.apellidos;
      if (/nombre_completo|solicitante|titular|interesad/.test(key)) return p.nombreCompleto;
      if (/nombre/.test(key)) return p.nombre;
      if (/domicilio|direccion/.test(key)) return p.domicilio;
      if (/municipio|localidad/.test(key)) return p.municipio;
      if (/provincia/.test(key)) return p.provincia;
      return r.pick([
        'Según documentación adjunta',
        'Uso particular',
        'Deportivo',
        'Ver anexo',
        'Ninguno',
        'Ejemplo',
      ]);
  }
}
