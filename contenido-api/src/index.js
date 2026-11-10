/* =====================================================================
   API de contenido — Seguridad del Paciente
   Worker de Cloudflare + D1. Todo el acceso a datos está en este archivo
   (SQL simple) para poder llevarlo a la intranet con SQL Server cambiando
   solo la capa de datos. Marcado con "SQLITE:" lo que habría que adaptar.

   Sin sesión: POST /api/login   /api/logout. Páginas: "/" exige sesión, "/login" no.
   Cualquier usuario con sesión: GET /api/yo /api/contenido /api/cursos /api/videos /api/textos,
                                 POST /api/clave (cambio de clave propio)
   Editores y admin:  /api/admin/cursos, /textos, /tarjetas, /zonas, /videos
   Solo admin:        /api/admin/usuarios (incluye /lote)
   ===================================================================== */

const SESION_HORAS = 8;
const PBKDF2_ITERACIONES = 100000; // máximo que permite Workers
const MAX_FALLOS = 5;              // intentos de login fallidos por usuario cada 15 min
const ROLES = ['admin', 'editor', 'usuario']; // usuario = personal que solo consulta
const RE_USUARIO = /^[a-z0-9_]{3,32}$/;
const MAX_LOTE = 10;               // usuarios por solicitud en la importación

/* ---------- Utilidades ---------- */
function json(datos, estado = 200, cabeceras = {}) {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...cabeceras },
  });
}
const error = (estado, mensaje) => json({ error: mensaje }, estado);

const aHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const deHex = (hex) => Uint8Array.from(hex.match(/../g) || [], (h) => parseInt(h, 16));

async function sha256Hex(texto) {
  return aHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
}

async function hashClave(clave, salHex) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: deHex(salHex), iterations: PBKDF2_ITERACIONES },
    material,
    256,
  );
  return aHex(bits);
}

function iguales(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function leerCookie(request, nombre) {
  const c = request.headers.get('cookie') || '';
  for (const parte of c.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nombre) return v.join('=');
  }
  return null;
}

async function leerJson(request) {
  try {
    const d = await request.json();
    return d && typeof d === 'object' ? d : null;
  } catch {
    return null;
  }
}

const cadena = (v, max, min = 0) => typeof v === 'string' && v.trim().length >= min && v.length <= max;
const RUTA_RELATIVA = /^[A-Za-z0-9_\-./%]+$/;
const URL_HTTP = /^https?:\/\/[^\s]+$/;

async function auditar(env, usuarioId, accion, entidad, referencia, detalle) {
  await env.DB.prepare('INSERT INTO auditoria (usuario_id, accion, entidad, referencia, detalle) VALUES (?, ?, ?, ?, ?)')
    .bind(usuarioId, accion, entidad, referencia ?? null, detalle ?? null)
    .run();
}
const stmtAuditoria = (env, usuarioId, accion, entidad, referencia, detalle) =>
  env.DB.prepare('INSERT INTO auditoria (usuario_id, accion, entidad, referencia, detalle) VALUES (?, ?, ?, ?, ?)')
    .bind(usuarioId, accion, entidad, referencia ?? null, detalle ?? null);

/* ---------- Sesión ---------- */
async function usuarioActual(request, env) {
  const token = leerCookie(request, 'sid');
  if (!token || token.length < 32) return null;
  const fila = await env.DB.prepare(
    `SELECT u.id, u.usuario, u.rol
       FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.token_hash = ? AND s.expira > datetime('now') AND u.activo = 1`, // SQLITE: datetime('now')
  ).bind(await sha256Hex(token)).first();
  return fila || null;
}

function origenValido(request) {
  const origen = request.headers.get('origin');
  if (!origen) return false;
  try {
    return new URL(origen).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function login(request, env) {
  const d = await leerJson(request);
  if (!d || !cadena(d.usuario, 64, 1) || !cadena(d.clave, 200, 1)) return error(400, 'Faltan usuario o clave.');
  const usuario = d.usuario.trim().toLowerCase();

  const fallos = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM auditoria
      WHERE accion = 'login_fallido' AND referencia = ? AND fecha > datetime('now', '-15 minutes')`, // SQLITE: datetime
  ).bind(usuario).first();
  if (fallos.n >= MAX_FALLOS) return error(429, 'Demasiados intentos. Espera unos minutos.');

  const fila = await env.DB.prepare('SELECT id, clave_hash, clave_sal, activo FROM usuarios WHERE usuario = ?').bind(usuario).first();
  // Si el usuario no existe se hace igual el cálculo, para no delatar por tiempo qué usuarios existen.
  const sal = fila ? fila.clave_sal : '00'.repeat(16);
  const calculado = await hashClave(d.clave, sal);
  const ok = fila && fila.activo === 1 && iguales(calculado, fila.clave_hash);

  if (!ok) {
    await auditar(env, fila ? fila.id : null, 'login_fallido', 'sesion', usuario, null);
    return error(401, 'Usuario o clave incorrectos.');
  }

  const token = aHex(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM sesiones WHERE expira <= datetime('now')`), // SQLITE: datetime
    env.DB.prepare(`INSERT INTO sesiones (token_hash, usuario_id, expira) VALUES (?, ?, datetime('now', '+${SESION_HORAS} hours'))`)
      .bind(await sha256Hex(token), fila.id),
    stmtAuditoria(env, fila.id, 'ingreso', 'sesion', usuario, null),
  ]);
  const cookie = `sid=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESION_HORAS * 3600}`;
  return json({ ok: true }, 200, { 'set-cookie': cookie });
}

async function logout(request, env) {
  const token = leerCookie(request, 'sid');
  if (token) await env.DB.prepare('DELETE FROM sesiones WHERE token_hash = ?').bind(await sha256Hex(token)).run();
  return json({ ok: true }, 200, { 'set-cookie': 'sid=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
}

/* ---------- Lectura pública ---------- */
async function listarCursos(env, soloPublicados) {
  const [cursos, parrafos, docs] = await env.DB.batch([
    env.DB.prepare(`SELECT id, titulo, resumen, orden, publicado, video_id FROM cursos ${soloPublicados ? 'WHERE publicado = 1' : ''} ORDER BY orden, id`),
    env.DB.prepare('SELECT curso_id, texto FROM curso_parrafos ORDER BY curso_id, orden, id'),
    env.DB.prepare('SELECT curso_id, titulo, url FROM curso_documentos ORDER BY curso_id, orden, id'),
  ]);
  return cursos.results.map((c) => ({
    id: c.id,
    titulo: c.titulo,
    resumen: c.resumen,
    orden: c.orden,
    publicado: c.publicado === 1,
    video: c.video_id,
    texto: parrafos.results.filter((p) => p.curso_id === c.id).map((p) => p.texto),
    documentos: docs.results.filter((x) => x.curso_id === c.id).map((x) => ({ titulo: x.titulo, archivo: x.url })),
  }));
}

async function listarVideos(env) {
  const { results } = await env.DB.prepare(`SELECT id, titulo, estado FROM videos ORDER BY creado, id`).all();
  return results.map((v) => ({
    id: v.id,
    titulo: v.titulo,
    estado: v.estado,
    master: `media/videos/${v.id}/master.m3u8`,
    poster: `media/videos/${v.id}/poster.webp`,
  }));
}

async function listarTextos(env) {
  const { results } = await env.DB.prepare('SELECT clave, valor, descripcion FROM textos_sitio ORDER BY clave').all();
  return results;
}

/* ---------- Cursos (editores) ---------- */
function validarCurso(d) {
  if (!d) return 'Cuerpo inválido.';
  if (!cadena(d.titulo, 200, 1)) return 'El título es obligatorio (máx. 200).';
  if (!cadena(d.resumen ?? '', 500)) return 'Resumen demasiado largo (máx. 500).';
  if (!Number.isInteger(d.orden ?? 0)) return 'El orden debe ser un número entero.';
  if (d.video != null && !cadena(d.video, 200, 1)) return 'Video inválido.';
  const texto = d.texto ?? [];
  if (!Array.isArray(texto) || texto.length > 100 || texto.some((t) => !cadena(t, 20000))) return 'Texto inválido.';
  const docs = d.documentos ?? [];
  if (!Array.isArray(docs) || docs.length > 50) return 'Documentos inválidos.';
  for (const x of docs) {
    if (!x || !cadena(x.titulo, 200, 1) || !cadena(x.archivo, 500, 1)) return 'Cada documento necesita título y archivo.';
    if (!URL_HTTP.test(x.archivo) && !RUTA_RELATIVA.test(x.archivo)) return 'Ruta de documento inválida.';
  }
  return null;
}

function slug(texto) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'curso';
}

async function guardarCurso(env, usuario, id, d, nuevo) {
  const error_ = validarCurso(d);
  if (error_) return error(400, error_);
  if (d.video) {
    const v = await env.DB.prepare('SELECT id FROM videos WHERE id = ?').bind(d.video).first();
    if (!v) return error(400, 'El video indicado no existe.');
  }
  const existe = await env.DB.prepare('SELECT id FROM cursos WHERE id = ?').bind(id).first();
  if (nuevo && existe) return error(409, 'Ya existe un curso con ese identificador.');
  if (!nuevo && !existe) return error(404, 'Curso no encontrado.');

  const sentencias = [
    nuevo
      ? env.DB.prepare('INSERT INTO cursos (id, titulo, resumen, orden, publicado, video_id) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(id, d.titulo.trim(), d.resumen ?? '', d.orden ?? 0, d.publicado === false ? 0 : 1, d.video ?? null)
      : env.DB.prepare(`UPDATE cursos SET titulo = ?, resumen = ?, orden = ?, publicado = ?, video_id = ?, actualizado = datetime('now') WHERE id = ?`) // SQLITE: datetime
          .bind(d.titulo.trim(), d.resumen ?? '', d.orden ?? 0, d.publicado === false ? 0 : 1, d.video ?? null, id),
    env.DB.prepare('DELETE FROM curso_parrafos WHERE curso_id = ?').bind(id),
    env.DB.prepare('DELETE FROM curso_documentos WHERE curso_id = ?').bind(id),
  ];
  (d.texto ?? []).forEach((t, i) => sentencias.push(
    env.DB.prepare('INSERT INTO curso_parrafos (curso_id, orden, texto) VALUES (?, ?, ?)').bind(id, i + 1, t)));
  (d.documentos ?? []).forEach((x, i) => sentencias.push(
    env.DB.prepare('INSERT INTO curso_documentos (curso_id, orden, titulo, url) VALUES (?, ?, ?, ?)').bind(id, i + 1, x.titulo.trim(), x.archivo)));
  sentencias.push(stmtAuditoria(env, usuario.id, nuevo ? 'crear' : 'editar', 'curso', id, d.titulo.trim()));

  await env.DB.batch(sentencias);
  return json({ ok: true, id }, nuevo ? 201 : 200);
}

async function rutasCursos(request, env, usuario, partes) {
  const metodo = request.method;
  if (partes.length === 0) {
    if (metodo === 'GET') return json(await listarCursos(env, false));
    if (metodo === 'POST') {
      const d = await leerJson(request);
      if (!d || !cadena(d.titulo, 200, 1)) return error(400, 'El título es obligatorio.');
      let base = slug(d.titulo), id = base, n = 2;
      while (await env.DB.prepare('SELECT id FROM cursos WHERE id = ?').bind(id).first()) id = `${base}-${n++}`;
      return guardarCurso(env, usuario, id, d, true);
    }
  } else if (partes.length === 1) {
    const id = decodeURIComponent(partes[0]);
    if (metodo === 'PUT') return guardarCurso(env, usuario, id, await leerJson(request), false);
    if (metodo === 'DELETE') {
      const r = await env.DB.batch([
        env.DB.prepare('DELETE FROM cursos WHERE id = ?').bind(id), // parrafos y documentos caen por ON DELETE CASCADE
        stmtAuditoria(env, usuario.id, 'borrar', 'curso', id, null),
      ]);
      return r[0].meta.changes ? json({ ok: true }) : error(404, 'Curso no encontrado.');
    }
  }
  return error(405, 'Método no permitido.');
}

/* ---------- Tarjetas por zona ---------- */
// Cada zona corresponde a un contenedor data-zona="…" de app-plataforma/index.html.
const ZONAS = {
  'inicio-modulos': 'Inicio · Explora la plataforma',
  conoce: 'Página Conoce',
  detecta: 'Página Detecta',
  aprende: 'Página Aprende',
  perfil: 'Página Perfil',
  'panel-admin': 'Página Panel Admin',
};

async function listarTarjetas(env, soloPublicadas) {
  const { results } = await env.DB.prepare(
    `SELECT id, zona, orden, icono, titulo, texto, boton, enlace, publicado FROM tarjetas
      ${soloPublicadas ? 'WHERE publicado = 1' : ''} ORDER BY zona, orden, id`,
  ).all();
  return results.map((t) => ({ ...t, publicado: t.publicado === 1 }));
}

function validarTarjeta(d) {
  if (!d) return 'Cuerpo inválido.';
  if (!Object.hasOwn(ZONAS, d.zona)) return 'Zona inválida.';
  if (!cadena(d.titulo, 200, 1)) return 'El título es obligatorio (máx. 200).';
  if (!cadena(d.texto ?? '', 1000)) return 'Texto demasiado largo (máx. 1000).';
  if (!cadena(d.icono ?? '', 16)) return 'Icono demasiado largo (máx. 16 caracteres).';
  if (!cadena(d.boton ?? '', 60)) return 'Texto del botón demasiado largo (máx. 60).';
  if (!Number.isInteger(d.orden ?? 0)) return 'El orden debe ser un número entero.';
  const enlace = d.enlace ?? '';
  if (!cadena(enlace, 500)) return 'Enlace demasiado largo.';
  if (enlace && !/^#[a-z0-9-]{1,40}$/.test(enlace) && !URL_HTTP.test(enlace) && !RUTA_RELATIVA.test(enlace)) {
    return 'Enlace inválido: usa #seccion, una dirección https://… o una ruta de archivo.';
  }
  if ((d.boton ?? '') && !enlace) return 'Si la tarjeta tiene botón, indica a dónde lleva (enlace).';
  return null;
}

async function rutasTarjetas(request, env, usuario, partes) {
  const metodo = request.method;
  if (partes.length === 0 && metodo === 'GET') return json(await listarTarjetas(env, false));
  if (partes.length === 0 && metodo === 'POST') {
    const d = await leerJson(request);
    const e = validarTarjeta(d);
    if (e) return error(400, e);
    const r = await env.DB.prepare('INSERT INTO tarjetas (zona, orden, icono, titulo, texto, boton, enlace, publicado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(d.zona, d.orden ?? 0, d.icono ?? '', d.titulo.trim(), d.texto ?? '', d.boton ?? '', d.enlace ?? '', d.publicado === false ? 0 : 1).run();
    await auditar(env, usuario.id, 'crear', 'tarjeta', String(r.meta.last_row_id), d.titulo.trim());
    return json({ ok: true, id: r.meta.last_row_id }, 201);
  }
  const id = Number(partes[0]);
  if (partes.length === 1 && Number.isInteger(id)) {
    if (metodo === 'PUT') {
      const d = await leerJson(request);
      const e = validarTarjeta(d);
      if (e) return error(400, e);
      const r = await env.DB.prepare(`UPDATE tarjetas SET zona = ?, orden = ?, icono = ?, titulo = ?, texto = ?, boton = ?, enlace = ?, publicado = ?, actualizado = datetime('now') WHERE id = ?`) // SQLITE: datetime
        .bind(d.zona, d.orden ?? 0, d.icono ?? '', d.titulo.trim(), d.texto ?? '', d.boton ?? '', d.enlace ?? '', d.publicado === false ? 0 : 1, id).run();
      if (!r.meta.changes) return error(404, 'Tarjeta no encontrada.');
      await auditar(env, usuario.id, 'editar', 'tarjeta', String(id), d.titulo.trim());
      return json({ ok: true });
    }
    if (metodo === 'DELETE') {
      const r = await env.DB.prepare('DELETE FROM tarjetas WHERE id = ?').bind(id).run();
      if (!r.meta.changes) return error(404, 'Tarjeta no encontrada.');
      await auditar(env, usuario.id, 'borrar', 'tarjeta', String(id), null);
      return json({ ok: true });
    }
  }
  return error(405, 'Método no permitido.');
}

/** Todo lo que necesita el sitio para pintarse en una sola petición. */
async function contenidoPublico(env) {
  const [textos, tarjetas] = await Promise.all([listarTextos(env), listarTarjetas(env, true)]);
  const porZona = Object.fromEntries(Object.keys(ZONAS).map((z) => [z, []]));
  for (const t of tarjetas) if (porZona[t.zona]) porZona[t.zona].push({ icono: t.icono, titulo: t.titulo, texto: t.texto, boton: t.boton, enlace: t.enlace });
  return { textos: Object.fromEntries(textos.map((t) => [t.clave, t.valor])), tarjetas: porZona };
}

/* ---------- Textos del sitio (editores) ---------- */
async function rutasTextos(request, env, usuario, partes) {
  if (partes.length === 0 && request.method === 'GET') return json(await listarTextos(env));
  if (partes.length === 1 && request.method === 'PUT') {
    const clave = decodeURIComponent(partes[0]);
    const d = await leerJson(request);
    if (!/^[a-z0-9_.-]{1,80}$/.test(clave)) return error(400, 'Clave inválida.');
    if (!d || !cadena(d.valor, 5000)) return error(400, 'Valor inválido (máx. 5000).');
    if (!(await env.DB.prepare('SELECT clave FROM textos_sitio WHERE clave = ?').bind(clave).first())) return error(404, 'Ese texto no existe en el sitio.');
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO textos_sitio (clave, valor, descripcion) VALUES (?, ?, ?)
                      ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado = datetime('now')`) // SQLITE: upsert y datetime
        .bind(clave, d.valor, cadena(d.descripcion ?? '', 200) ? d.descripcion ?? null : null),
      stmtAuditoria(env, usuario.id, 'editar', 'texto_sitio', clave, null),
    ]);
    return json({ ok: true });
  }
  return error(405, 'Método no permitido.');
}

/* ---------- Usuarios (solo admin) ---------- */
async function nuevaClave(clave) {
  const sal = aHex(crypto.getRandomValues(new Uint8Array(16)));
  return { sal, hash: await hashClave(clave, sal) };
}

async function rutasUsuarios(request, env, usuario, partes) {
  if (usuario.rol !== 'admin') return error(403, 'Solo un administrador puede gestionar usuarios.');
  if (partes.length === 0 && request.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT id, usuario, rol, activo, creado FROM usuarios ORDER BY id').all();
    return json(results);
  }
  // Importación en lote: el panel envía de a pocos (cada clave cuesta CPU al hashearse).
  if (partes.length === 1 && partes[0] === 'lote' && request.method === 'POST') {
    const d = await leerJson(request);
    if (!d || !Array.isArray(d.usuarios) || d.usuarios.length < 1 || d.usuarios.length > MAX_LOTE) return error(400, `Envía entre 1 y ${MAX_LOTE} usuarios por solicitud.`);
    if (!ROLES.includes(d.rol)) return error(400, 'Rol inválido.');
    const resultado = [];
    for (const u of d.usuarios) {
      const nombre = typeof u?.usuario === 'string' ? u.usuario.trim().toLowerCase() : '';
      const clave = typeof u?.clave === 'string' ? u.clave : '';
      if (!RE_USUARIO.test(nombre)) { resultado.push({ usuario: nombre, estado: 'invalido', motivo: 'Usuario: 3 a 32 caracteres (minúsculas, números y _).' }); continue; }
      if (clave.length < 10 || clave.length > 200) { resultado.push({ usuario: nombre, estado: 'invalido', motivo: 'La clave debe tener al menos 10 caracteres.' }); continue; }
      if (await env.DB.prepare('SELECT id FROM usuarios WHERE usuario = ?').bind(nombre).first()) { resultado.push({ usuario: nombre, estado: 'existe', motivo: 'Ya existe.' }); continue; }
      const { sal, hash } = await nuevaClave(clave);
      await env.DB.batch([
        env.DB.prepare('INSERT INTO usuarios (usuario, clave_hash, clave_sal, rol) VALUES (?, ?, ?, ?)').bind(nombre, hash, sal, d.rol),
        stmtAuditoria(env, usuario.id, 'crear', 'usuario', nombre, d.rol),
      ]);
      resultado.push({ usuario: nombre, estado: 'creado' });
    }
    return json({ resultado });
  }
  if (partes.length === 0 && request.method === 'POST') {
    const d = await leerJson(request);
    if (!d || !RE_USUARIO.test(d.usuario ?? '')) return error(400, 'Usuario: 3 a 32 caracteres (minúsculas, números y _).');
    if (!cadena(d.clave, 200) || d.clave.length < 10) return error(400, 'La clave debe tener al menos 10 caracteres.');
    if (!ROLES.includes(d.rol)) return error(400, 'Rol inválido.');
    if (await env.DB.prepare('SELECT id FROM usuarios WHERE usuario = ?').bind(d.usuario).first()) return error(409, 'Ese usuario ya existe.');
    const { sal, hash } = await nuevaClave(d.clave);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO usuarios (usuario, clave_hash, clave_sal, rol) VALUES (?, ?, ?, ?)').bind(d.usuario, hash, sal, d.rol),
      stmtAuditoria(env, usuario.id, 'crear', 'usuario', d.usuario, d.rol),
    ]);
    return json({ ok: true }, 201);
  }
  if (partes.length === 1 && request.method === 'PATCH') {
    const id = Number(partes[0]);
    const d = await leerJson(request);
    if (!Number.isInteger(id) || !d) return error(400, 'Solicitud inválida.');
    const objetivo = await env.DB.prepare('SELECT id, usuario FROM usuarios WHERE id = ?').bind(id).first();
    if (!objetivo) return error(404, 'Usuario no encontrado.');
    if (id === usuario.id && (d.rol !== undefined || d.activo !== undefined)) return error(400, 'No puedes cambiar tu propio rol ni desactivarte.');
    const sentencias = [];
    if (d.rol !== undefined) {
      if (!ROLES.includes(d.rol)) return error(400, 'Rol inválido.');
      sentencias.push(env.DB.prepare('UPDATE usuarios SET rol = ? WHERE id = ?').bind(d.rol, id));
    }
    if (d.activo !== undefined) {
      sentencias.push(env.DB.prepare('UPDATE usuarios SET activo = ? WHERE id = ?').bind(d.activo ? 1 : 0, id));
      if (!d.activo) sentencias.push(env.DB.prepare('DELETE FROM sesiones WHERE usuario_id = ?').bind(id));
    }
    if (d.clave !== undefined) {
      if (!cadena(d.clave, 200) || d.clave.length < 10) return error(400, 'La clave debe tener al menos 10 caracteres.');
      const { sal, hash } = await nuevaClave(d.clave);
      sentencias.push(env.DB.prepare('UPDATE usuarios SET clave_hash = ?, clave_sal = ? WHERE id = ?').bind(hash, sal, id));
      sentencias.push(env.DB.prepare('DELETE FROM sesiones WHERE usuario_id = ?').bind(id)); // cierra sus sesiones
    }
    if (!sentencias.length) return error(400, 'Nada que cambiar.');
    sentencias.push(stmtAuditoria(env, usuario.id, 'editar', 'usuario', objetivo.usuario, Object.keys(d).filter((k) => k !== 'clave').join(',') + (d.clave !== undefined ? ',clave' : '')));
    await env.DB.batch(sentencias);
    return json({ ok: true });
  }
  return error(405, 'Método no permitido.');
}

/* ---------- Cambio de clave propio (cualquier usuario) ---------- */
async function cambiarClavePropia(request, env, usuario) {
  const d = await leerJson(request);
  if (!d || !cadena(d.actual, 200, 1) || !cadena(d.nueva, 200)) return error(400, 'Faltan datos.');
  if (d.nueva.length < 10) return error(400, 'La clave nueva debe tener al menos 10 caracteres.');

  const fallos = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM auditoria
      WHERE accion = 'login_fallido' AND referencia = ? AND fecha > datetime('now', '-15 minutes')`, // SQLITE: datetime
  ).bind(usuario.usuario).first();
  if (fallos.n >= MAX_FALLOS) return error(429, 'Demasiados intentos. Espera unos minutos.');

  const fila = await env.DB.prepare('SELECT clave_hash, clave_sal FROM usuarios WHERE id = ?').bind(usuario.id).first();
  if (!fila || !iguales(await hashClave(d.actual, fila.clave_sal), fila.clave_hash)) {
    await auditar(env, usuario.id, 'login_fallido', 'sesion', usuario.usuario, 'cambio de clave');
    return error(400, 'La clave actual no es correcta.');
  }
  const { sal, hash } = await nuevaClave(d.nueva);
  const actual = await sha256Hex(leerCookie(request, 'sid'));
  await env.DB.batch([
    env.DB.prepare('UPDATE usuarios SET clave_hash = ?, clave_sal = ? WHERE id = ?').bind(hash, sal, usuario.id),
    env.DB.prepare('DELETE FROM sesiones WHERE usuario_id = ? AND token_hash <> ?').bind(usuario.id, actual), // cierra las demás sesiones
    stmtAuditoria(env, usuario.id, 'editar', 'usuario', usuario.usuario, 'clave propia'),
  ]);
  return json({ ok: true });
}

/* ---------- Enrutador ---------- */
const redirigir = (destino) => new Response(null, { status: 302, headers: { location: destino, 'cache-control': 'no-store' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ruta = url.pathname;
    const escritura = request.method !== 'GET' && request.method !== 'HEAD';

    try {
      // El panel separado ya no existe: la edición se hace dentro del aplicativo.
      if (ruta === '/admin' || ruta.startsWith('/admin/')) return redirigir('/');

      // Páginas: el aplicativo exige sesión; el login solo se muestra a quien no la tiene.
      if (ruta === '/' || ruta === '/index.html' || ruta === '/login' || ruta === '/login.html') {
        if (escritura) return error(405, 'Método no permitido.');
        const usuario = await usuarioActual(request, env);
        const esLogin = ruta.startsWith('/login');
        if (!usuario && !esLogin) return redirigir('/login');
        if (usuario && esLogin) return redirigir('/');
        return env.ASSETS.fetch(request);
      }
      if (!ruta.startsWith('/api/')) return env.ASSETS.fetch(request);

      const partes = ruta.replace(/^\/api\/?/, '').split('/').filter(Boolean);
      const recurso = partes.shift();

      if (escritura && !origenValido(request)) return error(403, 'Origen no permitido.');
      if (recurso === 'login' && request.method === 'POST') return await login(request, env);
      if (recurso === 'logout' && request.method === 'POST') return await logout(request, env);

      // Todo lo demás exige sesión (cualquier rol).
      const usuario = await usuarioActual(request, env);
      if (!usuario) return error(401, 'Inicia sesión.');

      if (recurso === 'yo' && request.method === 'GET') return json(usuario);
      if (recurso === 'clave' && request.method === 'POST') return await cambiarClavePropia(request, env, usuario);
      if (recurso === 'contenido' && request.method === 'GET') return json(await contenidoPublico(env));
      if (recurso === 'cursos' && request.method === 'GET') return json(await listarCursos(env, true));
      if (recurso === 'videos' && request.method === 'GET') return json((await listarVideos(env)).filter((v) => v.estado === 'listo'));
      if (recurso === 'textos' && request.method === 'GET') {
        return json(Object.fromEntries((await listarTextos(env)).map((t) => [t.clave, t.valor])));
      }

      if (recurso !== 'admin') return error(404, 'No encontrado.');
      if (usuario.rol === 'usuario') return error(403, 'No tienes permiso para editar.');

      const seccion = partes.shift();
      if (seccion === 'cursos') return await rutasCursos(request, env, usuario, partes);
      if (seccion === 'textos') return await rutasTextos(request, env, usuario, partes);
      if (seccion === 'tarjetas') return await rutasTarjetas(request, env, usuario, partes);
      if (seccion === 'zonas' && request.method === 'GET') return json(Object.entries(ZONAS).map(([zona, nombre]) => ({ zona, nombre })));
      if (seccion === 'usuarios') return await rutasUsuarios(request, env, usuario, partes);
      if (seccion === 'videos' && request.method === 'GET') return json(await listarVideos(env));
      return error(404, 'No encontrado.');
    } catch (e) {
      console.error(e);
      return error(500, 'Error interno.');
    }
  },
};
