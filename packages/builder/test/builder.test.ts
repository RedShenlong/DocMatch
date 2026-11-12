import { describe, expect, it } from 'vitest';
import { inferType, slugify } from '../src/lib/propose';
import { findPersonalData, markDistinctive } from '../src/lib/profile';
import { validateProfile } from '../src/lib/schema';

describe('propuesta de campos', () => {
  it('deduce el tipo por la etiqueta', () => {
    expect(inferType('DNI/NIE:')).toBe('dni_nie');
    expect(inferType('NIF/CIF de la entidad:')).toBe('nif_cif');
    expect(inferType('Fecha de nacimiento:')).toBe('date');
    expect(inferType('Correo electrónico:')).toBe('email');
    expect(inferType('Teléfono:')).toBe('phone');
    expect(inferType('C.P.:')).toBe('postal_code');
    expect(inferType('IBAN:')).toBe('iban');
    expect(inferType('Nº licencia anterior:')).toBe('number');
    expect(inferType('Firma del solicitante:')).toBe('signature');
    expect(inferType('Domicilio:')).toBe('text');
  });
  it('claves', () => expect(slugify('Fecha de nacimiento:')).toBe('fecha_de_nacimiento'));
});

describe('datos personales en la plantilla', () => {
  it('detecta DNI, IBAN, email y teléfono reales', () => {
    const f = findPersonalData([
      'Titular: 12345678Z',
      'Cuenta ES91 2100 0418 4502 0005 1332',
      'ana@gmail.com',
      'Tel. 612 345 678',
    ]);
    expect(f.join(' ')).toMatch(/DNI/);
    expect(f.join(' ')).toMatch(/IBAN/);
    expect(f.join(' ')).toMatch(/email/);
    expect(f.join(' ')).toMatch(/teléfono/);
  });
  it('no avisa de textos genéricos', () =>
    expect(findPersonalData(['DNI/NIE:', 'Modelo EJ-101', 'info@sede.example'])).toEqual([]));
});

describe('anclas distintivas', () => {
  it('marca título, código y subtítulo; no los encabezados de sección', () => {
    const a = (text: string, y: number, h = 0.012) => ({
      page: 0,
      text,
      norm: text.toLowerCase(),
      box: { x: 0.1, y, w: 0.5, h },
    });
    const anchors = [
      a('ORGANISMO DE EJEMPLO', 0.05),
      a('Modelo EJ-101', 0.05),
      a('SOLICITUD DE LICENCIA', 0.11, 0.02),
      a('Expedición o renovación de licencia', 0.135),
      a('1. Datos de la persona', 0.2),
      a('Nombre:', 0.23),
    ];
    markDistinctive(
      anchors,
      anchors.map((x) => x.box.h * 842),
    );
    expect(anchors.filter((x) => x.distinctive).map((x) => x.text)).toEqual([
      'Modelo EJ-101',
      'SOLICITUD DE LICENCIA',
      'Expedición o renovación de licencia',
    ]);
  });
});

describe('esquema', () => {
  it('rechaza perfiles inválidos', () => {
    expect(validateProfile({ schemaVersion: 1 }).length).toBeGreaterThan(0);
  });
});
