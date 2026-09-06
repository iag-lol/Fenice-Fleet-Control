/**
 * Crea o actualiza un usuario de acceso (login por RUT + contrasena) en
 * Supabase, sin pasar nunca una contrasena en texto plano por el SQL ni por
 * el historial de comandos.
 *
 * Es la unica via soportada para dar de alta al primer administrador: el
 * esquema (`supabase/schema.sql`) crea la tabla `usuarios` vacia a proposito,
 * nunca con una contrasena de fabrica conocida.
 *
 * Uso:
 *   node scripts/create-admin-user.mjs
 *   node scripts/create-admin-user.mjs --rut=12345678-9 --rol=administrador
 *
 * Cualquier dato que falte (RUT, nombre, contrasena) se pide de forma
 * interactiva. La contrasena se escribe enmascarada y nunca se muestra en la
 * salida del comando.
 */

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

const ROLES = ['administrador', 'supervisor', 'operador', 'invitado'];

// --- Entorno -----------------------------------------------------------
// Este script corre fuera de Next.js (no pasa por su carga de .env), asi que
// lee `.env.local` a mano. Las variables ya presentes en el proceso (CI,
// shell) tienen prioridad sobre el archivo.
function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    values[key] = rawValue.replace(/^["']|["']$/g, '');
  }
  return values;
}

const root = process.cwd();
const fileEnv = { ...loadEnvFile(resolve(root, '.env.local')), ...loadEnvFile(resolve(root, '.env')) };
const env = { ...fileEnv, ...process.env };

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en .env.local.\n' +
      'Configura Supabase antes de crear un usuario (ver docs/SUPABASE-INTEGRATION.md).',
  );
  process.exit(1);
}

// --- RUT: mismo algoritmo que src/lib/rut.ts ----------------------------
// Duplicado deliberadamente: este script corre con Node plano (sin el
// bundler de Next), y mantenerlo sin dependencias del arbol de `src/` evita
// arrastrar imports pensados para el bundler (algunos modulos de `src/lib`
// llevan la guarda `server-only`, que revienta fuera de Next).
function normalizeRut(input) {
  const cleaned = input.trim().replace(/[.\s]/g, '').toUpperCase();
  const match = /^(\d{1,8})-?(\d|K)$/.exec(cleaned);
  if (!match) return null;
  return `${match[1]}-${match[2]}`;
}

function isValidRut(input) {
  const normalized = normalizeRut(input);
  if (!normalized) return false;
  const [body, verifier] = normalized.split('-');
  if (Number(body) < 1_000_000) return false;

  let sum = 0;
  let multiplier = 2;
  for (let i = body.length - 1; i >= 0; i -= 1) {
    sum += Number(body[i]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  const expected = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
  return expected === verifier;
}

function validatePasswordStrength(password) {
  const errors = [];
  if (password.length < 10) errors.push('Debe tener al menos 10 caracteres.');
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) errors.push('Debe combinar mayusculas y minusculas.');
  if (!/\d/.test(password)) errors.push('Debe incluir al menos un numero.');
  return errors;
}

// --- Entrada interactiva -------------------------------------------------
function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    const match = /^--([a-zA-Z]+)=(.*)$/.exec(arg);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

function ask(rl, question) {
  return new Promise((res) => rl.question(question, res));
}

// Codigos de tecla de control, por numero: un literal de escape de control
// insertado a mano en el archivo fuente es fragil (algunas herramientas lo
// normalizan al guardar). Comparar codigos numericos es inequivoco.
const KEY_CTRL_C = 3;
const KEY_ENTER_CR = 13;
const KEY_ENTER_LF = 10;
const KEY_BACKSPACE = 8;
const KEY_DEL = 127;

/** Pregunta con la entrada enmascarada (asteriscos), para no imprimir la contrasena. */
function askHidden(rl, question) {
  return new Promise((res) => {
    let value = '';
    process.stdout.write(question);

    const cleanup = () => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };

    const onData = (chunk) => {
      const code = chunk[0];

      if (code === KEY_CTRL_C) {
        cleanup();
        process.stdout.write('\n');
        process.exit(1);
      }

      if (code === KEY_ENTER_CR || code === KEY_ENTER_LF) {
        cleanup();
        process.stdout.write('\n');
        res(value);
        return;
      }

      if (code === KEY_BACKSPACE || code === KEY_DEL) {
        if (value.length > 0) {
          value = value.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }

      value += chunk.toString('utf8');
      process.stdout.write('*');
    };

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

async function main() {
  const args = parseArgs();
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  let rut = args.rut ?? (await ask(rl, 'RUT (ej. 12345678-9): '));
  while (!isValidRut(rut)) {
    console.log('RUT invalido (revisa el digito verificador).');
    rut = await ask(rl, 'RUT (ej. 12345678-9): ');
  }
  rut = normalizeRut(rut);

  const nombreCompleto = args.nombre ?? (await ask(rl, 'Nombre completo: '));

  let rol = args.rol ?? 'administrador';
  if (!ROLES.includes(rol)) {
    console.log(`Rol invalido "${rol}". Se usa "administrador".`);
    rol = 'administrador';
  }

  let password = args.password ?? (await askHidden(rl, 'Contrasena: '));
  let strengthErrors = validatePasswordStrength(password);
  while (strengthErrors.length > 0) {
    console.log('Contrasena insuficiente:');
    for (const error of strengthErrors) console.log(`  - ${error}`);
    password = await askHidden(rl, 'Contrasena: ');
    strengthErrors = validatePasswordStrength(password);
  }

  const confirm = args.password ? password : await askHidden(rl, 'Confirma la contrasena: ');
  if (confirm !== password) {
    console.error('Las contrasenas no coinciden.');
    rl.close();
    process.exit(1);
  }

  rl.close();

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existing, error: lookupError } = await supabase
    .from('usuarios')
    .select('id')
    .eq('rut', rut)
    .maybeSingle();

  if (lookupError) {
    console.error('No fue posible consultar la tabla usuarios:', lookupError.message);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);

  if (existing) {
    const { error } = await supabase
      .from('usuarios')
      .update({
        nombre_completo: nombreCompleto,
        rol,
        password_hash: passwordHash,
        activo: true,
        intentos_fallidos: 0,
        bloqueado_hasta: null,
      })
      .eq('id', existing.id);

    if (error) {
      console.error('No fue posible actualizar el usuario:', error.message);
      process.exit(1);
    }
    console.log(`Usuario ${rut} actualizado (rol: ${rol}).`);
    return;
  }

  const { error } = await supabase.from('usuarios').insert({
    rut,
    nombre_completo: nombreCompleto,
    rol,
    password_hash: passwordHash,
    activo: true,
  });

  if (error) {
    console.error('No fue posible crear el usuario:', error.message);
    process.exit(1);
  }
  console.log(`Usuario ${rut} creado (rol: ${rol}).`);
}

main().catch((error) => {
  console.error('Error inesperado:', error);
  process.exit(1);
});
