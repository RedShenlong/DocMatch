#!/usr/bin/env node
// Lanzador de la CLI (ejecuta el código TypeScript con tsx).
import { register } from 'tsx/esm/api';
register();
await import('../src/cli.ts');
