import { describe, expect, it } from 'vitest';
import {
  parseSpanishDate,
  validate,
  validateDate,
  validateDniNie,
  validateEmail,
  validateIban,
  validateNifCif,
  validatePhone,
  validatePostalCode,
} from '../src/fields/validators';

describe('DNI/NIE', () => {
  it('acepta DNI con letra correcta (con y sin separadores)', () => {
    expect(validateDniNie('12345678Z')).toBeNull();
    expect(validateDniNie('12.345.678-z')).toBeNull();
    expect(validateDniNie('00000000T')).toBeNull();
  });
  it('detecta letra incorrecta', () => expect(validateDniNie('12345678A')).toBe('dni_letter'));
  it('detecta formato inválido', () => {
    expect(validateDniNie('1234567Z')).toBe('dni_format');
    expect(validateDniNie('ABC')).toBe('dni_format');
  });
  it('acepta NIE X/Y/Z', () => {
    expect(validateDniNie('X1234567L')).toBeNull();
    expect(validateDniNie('Y1234567X')).toBeNull();
    expect(validateDniNie('Z1234567R')).toBeNull();
    expect(validateDniNie('X1234567A')).toBe('dni_letter');
  });
  it('corrige confusiones de OCR en los dígitos solo si se indica', () => {
    expect(validateDniNie('l2345678Z', true)).toBeNull();
    expect(validateDniNie('l2345678Z')).toBe('dni_format');
  });
});

describe('NIF/CIF', () => {
  it('acepta CIF con dígito y letra de control', () => {
    expect(validateNifCif('B12345674')).toBeNull();
    expect(validateNifCif('A58818501')).toBeNull();
    expect(validateNifCif('Q2826000H')).toBeNull();
    expect(validateNifCif('P2807900B')).toBeNull();
  });
  it('rechaza control incorrecto', () => expect(validateNifCif('B12345675')).toBe('nif_control'));
  it('acepta NIF de persona física', () => expect(validateNifCif('12345678Z')).toBeNull());
  it('rechaza formato', () => expect(validateNifCif('1234')).toBe('nif_format'));
});

describe('IBAN', () => {
  it('módulo 97', () => {
    expect(validateIban('ES91 2100 0418 4502 0005 1332')).toBeNull();
    expect(validateIban('ES9121000418450200051333')).toBe('iban_checksum');
    expect(validateIban('DE89 3704 0044 0532 0130 00')).toBeNull();
  });
  it('formato y longitud de España', () => {
    expect(validateIban('ES91 2100')).toBe('iban_format');
    expect(validateIban('ES912100041845020005133')).toBe('iban_format');
  });
});

describe('fechas', () => {
  it('formatos españoles', () => {
    expect(validateDate('29/02/2024')).toBeNull();
    expect(validateDate('1-3-99')).toBeNull();
    expect(validateDate('01.12.2010')).toBeNull();
    expect(validateDate('3 de marzo de 2021')).toBeNull();
    expect(validateDate('2021-03-03')).toBeNull();
  });
  it('fechas imposibles', () => {
    expect(validateDate('29/02/2023')).toBe('date_invalid');
    expect(validateDate('35/16/1978')).toBe('date_invalid');
    expect(validateDate('31/04/2020')).toBe('date_invalid');
    expect(validateDate('ayer')).toBe('date_invalid');
  });
  it('parsea el mes en texto', () =>
    expect(parseSpanishDate('7 de setiembre de 2020')).toEqual({ d: 7, m: 9, y: 2020 }));
});

describe('otros formatos', () => {
  it('email', () => {
    expect(validateEmail('ana.perez@correo.es')).toBeNull();
    expect(validateEmail('ana@correo')).toBe('email_format');
  });
  it('teléfono', () => {
    expect(validatePhone('+34 612 345 678')).toBeNull();
    expect(validatePhone('912345678')).toBeNull();
    expect(validatePhone('12345')).toBe('phone_format');
  });
  it('código postal', () => {
    expect(validatePostalCode('28013')).toBeNull();
    expect(validatePostalCode('53000')).toBe('postal_code_format');
    expect(validatePostalCode('2801')).toBe('postal_code_format');
  });
  it('patrón adicional del perfil', () => {
    expect(validate('text', 'ABC-123', '^[A-Z]{3}-\\d{3}$')).toBeNull();
    expect(validate('text', 'abc', '^[A-Z]{3}-\\d{3}$')).toBe('pattern');
  });
});
