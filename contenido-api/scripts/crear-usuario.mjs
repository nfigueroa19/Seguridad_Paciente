// Crea (o actualiza la clave de) un usuario en D1. La clave se pide por consola sin mostrarse
// y se guarda hasheada (PBKDF2-SHA256, igual que el Worker). Nunca pasa por el chat ni el repositorio.
//
// Uso (desde la raíz del proyecto):
//   node contenido-api/scripts/crear-usuario.mjs <usuario> <admin|editor|usuario> [--local]
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [usuario, rol, ...flags] = process.argv.slice(2);
const local = flags.includes('--local');
if (!/^[a-z0-9_]{3,32}$/.test(usuario ?? '') || !['admin', 'editor', 'usuario'].includes(rol)) {
  console.error('Uso: node contenido-api/scripts/crear-usuario.mjs <usuario> <admin|editor|usuario> [--local]');
  process.exit(1);
}

function pedirClave(pregunta) {
  return new Promise((resolver) => {
    process.stdout.write(pregunta);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let clave = '';
    stdin.on('data', function alTecla(t) {
      for (const c of t) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', alTecla);
          process.stdout.write('\n');
          return resolver(clave);
        }
        if (c === '\u0003') process.exit(1); // Ctrl+C
        if (c === '\u007f' || c === '\b') clave = clave.slice(0, -1);
        else clave += c;
      }
    });
  });
}

if (!process.stdin.isTTY) {
  console.error('Este script debe correr en una terminal interactiva (pide la clave sin mostrarla).');
  process.exit(1);
}

const clave = await pedirClave(`Clave para ${usuario} (mín. 10 caracteres): `);
const repetida = await pedirClave('Repite la clave: ');
if (clave !== repetida) { console.error('Las claves no coinciden.'); process.exit(1); }
if (clave.length < 10) { console.error('La clave debe tener al menos 10 caracteres.'); process.exit(1); }

const sal = randomBytes(16).toString('hex');
const hash = pbkdf2Sync(clave, Buffer.from(sal, 'hex'), 100000, 32, 'sha256').toString('hex');

const sql = `INSERT INTO usuarios (usuario, clave_hash, clave_sal, rol) VALUES ('${usuario}', '${hash}', '${sal}', '${rol}')
ON CONFLICT(usuario) DO UPDATE SET clave_hash = excluded.clave_hash, clave_sal = excluded.clave_sal, rol = excluded.rol, activo = 1;
DELETE FROM sesiones WHERE usuario_id = (SELECT id FROM usuarios WHERE usuario = '${usuario}');`;

const carpeta = mkdtempSync(join(tmpdir(), 'segpaciente-'));
const archivo = join(carpeta, 'usuario.sql');
writeFileSync(archivo, sql);
const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'segpaciente-contenido', local ? '--local' : '--remote', '--yes', `--file=${archivo}`], { stdio: 'inherit', shell: true });
unlinkSync(archivo);
process.exit(r.status ?? 1);
