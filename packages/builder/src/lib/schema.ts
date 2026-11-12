import Ajv2020 from 'ajv/dist/2020';
import schema from './profile.schema.json';

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

/** Valida un perfil contra el JSON Schema (profile.schema.json). Devuelve la lista de errores. */
export function validateProfile(p: unknown): string[] {
  if (validate(JSON.parse(JSON.stringify(p)))) return [];
  return (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`);
}

export { schema as profileSchema };
