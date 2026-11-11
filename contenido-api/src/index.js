/* =====================================================================
   API de contenido — Seguridad del Paciente
   Worker de Cloudflare + D1. Todo el acceso a datos está en este archivo
   (SQL simple) para poder llevarlo a la intranet con SQL Server cambiando
   solo la capa de datos. Marcado con "SQLITE:" lo que habría que adaptar.

   Sin sesión: POST /api/login   /api/logout. Páginas: "/" exige sesión, "/login" no.
   Con secreto compartido (no con sesión): POST /api/interno/video (aviso de GitHub Actions al terminar de convertir).
   Cualquier usuario con sesión: GET /api/yo /api/contenido /api/cursos /api/videos /api/textos,
                                 POST /api/clave (cambio de clave propio)
   Editores y admin:  /api/admin/cursos, /textos, /tarjetas, /zonas, /videos, /archivos (subida a R2)
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
  const [cursos, parrafos, docs, vids] = await env.DB.batch([
    env.DB.prepare(`SELECT id, titulo, resumen, orden, publicado, video_id FROM cursos ${soloPublicados ? 'WHERE publicado = 1' : ''} ORDER BY orden, id`),
    env.DB.prepare('SELECT curso_id, texto FROM curso_parrafos ORDER BY curso_id, orden, id'),
    env.DB.prepare('SELECT curso_id, titulo, url FROM curso_documentos ORDER BY curso_id, orden, id'),
    env.DB.prepare('SELECT curso_id, video_id, titulo, descripcion, documentos FROM curso_videos ORDER BY curso_id, orden, id'),
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
    videos: vids.results.filter((x) => x.curso_id === c.id).map((x) => ({
      video: x.video_id, titulo: x.titulo, descripcion: x.descripcion, documentos: documentosDeVideo(x.documentos),
    })),
  }));
}

function documentosDeVideo(texto) {
  try { const a = JSON.parse(texto); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}

// Los videos convertidos en la nube (en_nube = 1) viven en un bucket público de R2 con dominio propio (VIDEOS_URL):
// reproducirlos no gasta peticiones del Worker. Los demás son archivos estáticos de la aplicación.
const formaVideo = (v, env) => {
  const base = v.en_nube && env.VIDEOS_URL ? `${env.VIDEOS_URL.replace(/\/$/, '')}/${v.id}` : `media/videos/${v.id}`;
  return { id: v.id, titulo: v.titulo, estado: v.estado, master: `${base}/master.m3u8`, poster: `${base}/poster.webp` };
};

async function listarVideos(env) {
  const { results } = await env.DB.prepare(`SELECT id, titulo, estado, en_nube FROM videos ORDER BY creado, id`).all();
  return results.map((v) => formaVideo(v, env));
}

// Un video con la misma huella (mismo contenido) ya subido y sin error: se reutiliza, no se convierte otra vez.
async function videoPorHuella(env, huella) {
  const v = await env.DB.prepare(`SELECT id, titulo, estado, en_nube FROM videos WHERE huella = ? AND estado != 'error' ORDER BY creado LIMIT 1`).bind(huella).first();
  return v ? formaVideo(v, env) : null;
}

async function listarTextos(env) {
  const { results } = await env.DB.prepare('SELECT clave, valor, descripcion FROM textos_sitio ORDER BY clave').all();
  return results;
}

/* ---------- Texto con formato: limpieza del HTML ---------- */
// Los textos editables se guardan como HTML mínimo. Aquí se filtran con una lista de permitidos (HTMLRewriter,
// un analizador HTML real). La MISMA lista vive en el navegador (app-plataforma/rico.js, limpiar): si se cambia una, se cambia la otra.
// El navegador vuelve a limpiar antes de pintar, así que esto es una segunda barrera, no la única.
const HTML_PERMITIDAS = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'br', 'p', 'div', 'span', 'ul', 'ol', 'li', 'a']);
const HTML_ELIMINAR = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'textarea', 'title', 'head', 'select', 'button', 'form', 'input', 'audio', 'video', 'canvas']);
const CSS_COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/i;
const CSS_TAMANO = /^(\d{1,3}(\.\d{1,2})?)(px|pt|em|rem)$/i;
const CSS_ALINEACION = /^(left|right|center|justify)$/i;
const ENLACE_PERMITIDO = /^(https?:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+|tel:[+0-9 ()-]+|#[a-z0-9-]{1,40}|media\/documentos\/[A-Za-z0-9_\-./%]+)$/i;

function tamanoCssValido(v) {
  const m = CSS_TAMANO.exec(v);
  if (!m) return false;
  const n = parseFloat(m[1]);
  const u = m[3].toLowerCase();
  const px = u === 'px' ? n : u === 'pt' ? (n * 4) / 3 : n * 16;
  return px >= 6 && px <= 200;
}

function estiloSeguro(texto) {
  const salida = [];
  for (const decl of String(texto || '').split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if (prop === 'color' && CSS_COLOR.test(val)) salida.push(`color:${val}`);
    else if (prop === 'background-color' && (CSS_COLOR.test(val) || /^transparent$/i.test(val))) salida.push(`background-color:${val}`);
    else if (prop === 'font-size' && tamanoCssValido(val)) salida.push(`font-size:${val}`);
    else if (prop === 'text-align' && CSS_ALINEACION.test(val)) salida.push(`text-align:${val.toLowerCase()}`);
  }
  return salida.join(';');
}

async function limpiarHtml(texto) {
  if (typeof texto !== 'string' || !texto.includes('<')) return texto; // sin etiquetas: nada que limpiar
  const lluvia = new HTMLRewriter()
    .on('*', {
      element(el) {
        const tag = el.tagName.toLowerCase();
        if (HTML_ELIMINAR.has(tag)) return el.remove();
        if (!HTML_PERMITIDAS.has(tag)) return el.removeAndKeepContent(); // se quita la etiqueta, se conserva el texto
        for (const [nombre, valor] of [...el.attributes]) {
          if (nombre === 'style') {
            const estilo = estiloSeguro(valor);
            if (estilo) el.setAttribute('style', estilo); else el.removeAttribute('style');
          } else if (!(tag === 'a' && nombre === 'href')) {
            el.removeAttribute(nombre);
          }
        }
        if (tag === 'a') {
          const href = (el.getAttribute('href') || '').trim();
          if (!ENLACE_PERMITIDO.test(href)) return el.removeAndKeepContent();
          el.setAttribute('href', href);
          if (/^https?:/i.test(href)) { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
        }
      },
      comments(c) { c.remove(); },
    })
    .onDocument({ comments(c) { c.remove(); } });
  return (await lluvia.transform(new Response(texto, { headers: { 'content-type': 'text/html; charset=utf-8' } })).text()).trim();
}

// Limpia los campos con formato de un curso (párrafos y descripciones de video) antes de validarlo.
async function limpiarCamposCurso(d) {
  if (!d || typeof d !== 'object') return d;
  if (Array.isArray(d.texto)) d.texto = await Promise.all(d.texto.map(limpiarHtml));
  if (Array.isArray(d.videos)) {
    for (const v of d.videos) if (v && typeof v.descripcion === 'string') v.descripcion = await limpiarHtml(v.descripcion);
  }
  return d;
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
  if (d.videos !== undefined) {
    if (!Array.isArray(d.videos) || d.videos.length > 20) return 'Videos inválidos (máx. 20).';
    for (const v of d.videos) {
      if (!v || !cadena(v.video, 200, 1)) return 'Cada video necesita su identificador.';
      if (!cadena(v.titulo ?? '', 200)) return 'El título del video es demasiado largo (máx. 200).';
      if (!cadena(v.descripcion ?? '', 10000)) return 'La descripción del video es demasiado larga.';
      const dv = v.documentos ?? [];
      if (!Array.isArray(dv) || dv.length > 20) return 'Documentos de video inválidos.';
      for (const x of dv) {
        if (!x || !cadena(x.titulo, 200, 1) || !cadena(x.archivo, 500, 1)) return 'Cada documento de video necesita título y archivo.';
        if (!URL_HTTP.test(x.archivo) && !RUTA_RELATIVA.test(x.archivo)) return 'Ruta de documento de video inválida.';
      }
    }
  }
  return null;
}

function slug(texto) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'curso';
}

async function guardarCurso(env, usuario, id, d, nuevo) {
  d = await limpiarCamposCurso(d);
  const error_ = validarCurso(d);
  if (error_) return error(400, error_);
  const existe = await env.DB.prepare('SELECT id FROM cursos WHERE id = ?').bind(id).first();
  if (nuevo && existe) return error(409, 'Ya existe un curso con ese identificador.');
  if (!nuevo && !existe) return error(404, 'Curso no encontrado.');

  // Videos del curso. Con `videos` se reemplaza la lista completa; con el campo antiguo `video` (formularios en ventana)
  // la lista no se toca si ese video ya era del curso.
  let lista = null;
  if (d.videos !== undefined) {
    const visto = new Set();
    lista = d.videos.filter((v) => !visto.has(v.video) && visto.add(v.video));
  } else if (d.video) {
    const previos = nuevo ? [] : (await env.DB.prepare('SELECT video_id FROM curso_videos WHERE curso_id = ?').bind(id).all()).results.map((x) => x.video_id);
    if (!previos.includes(d.video)) lista = [{ video: d.video }];
  } else {
    lista = [];
  }
  const ids = lista ? lista.map((v) => v.video) : (d.video ? [d.video] : []);
  const aProcesar = [];
  const enNube = [];
  for (const vid of ids) {
    const v = await env.DB.prepare('SELECT id, estado, en_nube FROM videos WHERE id = ?').bind(vid).first();
    if (!v) return error(400, 'Uno de los videos indicados no existe.');
    if (v.estado === 'subido' || v.estado === 'error') {
      aProcesar.push(vid);
      if (v.en_nube) enNube.push(vid);
    }
  }
  const principal = lista ? (lista[0]?.video ?? null) : (d.video ?? null);

  const sentencias = [
    nuevo
      ? env.DB.prepare('INSERT INTO cursos (id, titulo, resumen, orden, publicado, video_id) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(id, d.titulo.trim(), d.resumen ?? '', d.orden ?? 0, d.publicado === false ? 0 : 1, principal)
      : env.DB.prepare(`UPDATE cursos SET titulo = ?, resumen = ?, orden = ?, publicado = ?, video_id = ?, actualizado = datetime('now') WHERE id = ?`) // SQLITE: datetime
          .bind(d.titulo.trim(), d.resumen ?? '', d.orden ?? 0, d.publicado === false ? 0 : 1, principal, id),
    env.DB.prepare('DELETE FROM curso_parrafos WHERE curso_id = ?').bind(id),
    env.DB.prepare('DELETE FROM curso_documentos WHERE curso_id = ?').bind(id),
  ];
  (d.texto ?? []).forEach((t, i) => sentencias.push(
    env.DB.prepare('INSERT INTO curso_parrafos (curso_id, orden, texto) VALUES (?, ?, ?)').bind(id, i + 1, t)));
  (d.documentos ?? []).forEach((x, i) => sentencias.push(
    env.DB.prepare('INSERT INTO curso_documentos (curso_id, orden, titulo, url) VALUES (?, ?, ?, ?)').bind(id, i + 1, x.titulo.trim(), x.archivo)));
  if (lista) {
    sentencias.push(env.DB.prepare('DELETE FROM curso_videos WHERE curso_id = ?').bind(id));
    lista.forEach((v, i) => sentencias.push(
      env.DB.prepare('INSERT INTO curso_videos (curso_id, video_id, orden, titulo, descripcion, documentos) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, v.video, i + 1, (v.titulo ?? '').trim(), (v.descripcion ?? '').trim(),
          JSON.stringify((v.documentos ?? []).map((x) => ({ titulo: x.titulo.trim(), archivo: x.archivo }))))));
  }
  // La conversión empieza al guardar (no al subir), por si se sube un video equivocado.
  aProcesar.forEach((vid) => sentencias.push(env.DB.prepare(`UPDATE videos SET estado = 'procesando' WHERE id = ?`).bind(vid)));
  sentencias.push(stmtAuditoria(env, usuario.id, nuevo ? 'crear' : 'editar', 'curso', id, d.titulo.trim()));

  await env.DB.batch(sentencias);

  // Producción: la conversión la hace GitHub Actions. En local la hace convertidor-local.mjs (en_nube = 0).
  const sinIniciar = [];
  for (const vid of enNube) if (!(await dispararConversion(env, vid))) sinIniciar.push(vid);
  if (sinIniciar.length) {
    await env.DB.batch(sinIniciar.map((vid) => env.DB.prepare(`UPDATE videos SET estado = 'error' WHERE id = ?`).bind(vid)));
    return json({ ok: true, id, aviso: 'El curso se guardó, pero no se pudo iniciar la conversión de un video. Guarda de nuevo para reintentar.' }, nuevo ? 201 : 200);
  }
  return json({ ok: true, id }, nuevo ? 201 : 200);
}

// Pide a GitHub Actions que convierta el video (workflow_dispatch). Devuelve false si no pudo.
async function dispararConversion(env, id) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return false;
  try {
    const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/convertir-video.yml/dispatches`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'segpaciente-worker',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main', inputs: { video_id: id } }),
    });
    if (r.status !== 204) console.error('GitHub respondió', r.status, 'al iniciar la conversión de', id);
    return r.status === 204;
  } catch (e) {
    console.error(e);
    return false;
  }
}

// Aviso de GitHub Actions al terminar. No usa sesión: exige el secreto compartido VIDEO_CALLBACK_SECRET.
async function avisoConversion(request, env) {
  const esperado = env.VIDEO_CALLBACK_SECRET;
  const recibido = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!esperado || !recibido || !iguales(await sha256Hex(recibido), await sha256Hex(esperado))) return error(401, 'No autorizado.');
  const d = await leerJson(request);
  if (!d || typeof d.id !== 'string' || !/^[a-z0-9-]{1,120}$/.test(d.id) || !['listo', 'error'].includes(d.estado)) return error(400, 'Datos inválidos.');
  const v = await env.DB.prepare('SELECT id, estado, en_nube FROM videos WHERE id = ?').bind(d.id).first();
  if (!v || !v.en_nube) return error(404, 'Video no encontrado.');
  if (v.estado !== 'procesando') return json({ ok: true, ignorado: true });
  await env.DB.prepare('UPDATE videos SET estado = ? WHERE id = ?').bind(d.estado, d.id).run();
  if (d.estado === 'listo') await env.MEDIA.delete(`entrada/${d.id}.mp4`); // el original ya no hace falta: libera cupo
  return json({ ok: true });
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

async function limpiarTarjeta(d) {
  if (d && typeof d === 'object') {
    if (typeof d.titulo === 'string') d.titulo = await limpiarHtml(d.titulo);
    if (typeof d.texto === 'string') d.texto = await limpiarHtml(d.texto);
  }
  return d;
}

function validarTarjeta(d) {
  if (!d) return 'Cuerpo inválido.';
  if (!Object.hasOwn(ZONAS, d.zona)) return 'Zona inválida.';
  if (!cadena(d.titulo, 1000, 1)) return 'El título es obligatorio (muy largo).';
  if (!cadena(d.texto ?? '', 5000)) return 'Texto demasiado largo.';
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
    const d = await limpiarTarjeta(await leerJson(request));
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
      const d = await limpiarTarjeta(await leerJson(request));
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
    if (d && typeof d.valor === 'string') d.valor = await limpiarHtml(d.valor);
    if (!d || !cadena(d.valor, 20000)) return error(400, 'Valor inválido (máx. 20000).');
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

/* ---------- Archivos subidos (R2) ---------- */
// Documentos de curso y videos originales. Los documentos se sirven desde /media/documentos/… (con sesión);
// los videos van a entrada/ y se convierten a HLS al guardar el curso (GitHub Actions en producción, convertidor local en desarrollo).
const TIPOS_DOC = {
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
};
const MAX_DOC = 25 * 1024 * 1024;
const MAX_VIDEO = 100 * 1024 * 1024; // tope de una solicitud en el plan gratuito de Workers
// Tope propio de almacenamiento para no pasar de los 10 GB gratuitos de R2: originales + convertidos (≈ el doble).
// Al llegar al tope las subidas se rechazan con un mensaje claro; nunca se genera un cobro.
const CUPO_VIDEOS_BYTES = 4 * 1024 * 1024 * 1024;

async function subirArchivo(request, env, usuario, url) {
  const huella = (url.searchParams.get('huella') || '').toLowerCase();
  if (huella && !/^[0-9a-f]{64}$/.test(huella)) return error(400, 'Huella inválida.');
  // GET ?huella=… → ¿ya existe este video? (se consulta antes de subirlo)
  if (request.method === 'GET') return json(huella ? await videoPorHuella(env, huella) : null);
  if (request.method !== 'POST') return error(405, 'Método no permitido.');
  const tipo = url.searchParams.get('tipo');
  const nombre = (url.searchParams.get('nombre') || '').slice(0, 200);
  const largo = Number(request.headers.get('content-length'));
  if (!largo || !request.body) return error(411, 'Archivo vacío o sin tamaño.');
  const m = nombre.match(/\.([A-Za-z0-9]{1,5})$/);
  const ext = m ? m[1].toLowerCase() : '';
  const base = nombre.replace(/\.[^.]*$/, '').trim();
  const sufijo = crypto.randomUUID().slice(0, 8);

  if (tipo === 'documento') {
    if (!TIPOS_DOC[ext]) return error(400, 'Tipo de archivo no permitido. Usa PDF, Word, Excel, PowerPoint, TXT, CSV, PNG o JPG.');
    if (largo > MAX_DOC) return error(413, 'El archivo supera los 25 MB.');
    const clave = `documentos/${sufijo}-${slug(base)}.${ext}`;
    await env.MEDIA.put(clave, request.body, { httpMetadata: { contentType: TIPOS_DOC[ext] } });
    await env.DB.batch([stmtAuditoria(env, usuario.id, 'crear', 'documento', clave, nombre)]);
    return json({ archivo: `media/${clave}`, titulo: base || 'Documento' }, 201);
  }
  if (tipo === 'video') {
    if (ext !== 'mp4') return error(400, 'El video debe ser un archivo MP4.');
    if (largo > MAX_VIDEO) return error(413, 'El video supera los 100 MB que admite esta versión de prueba.');
    if (huella) {
      const repetido = await videoPorHuella(env, huella);
      if (repetido) return json({ ...repetido, repetido: true });
    }
    const nube = env.VIDEOS_URL ? 1 : 0;
    if (nube) {
      const { usado } = await env.DB.prepare(`SELECT COALESCE(SUM(bytes), 0) AS usado FROM videos WHERE en_nube = 1`).first();
      if (usado + largo > CUPO_VIDEOS_BYTES) {
        return error(507, 'Se alcanzó el cupo de almacenamiento gratuito para videos. Para subir otro hay que liberar espacio o ampliar el plan.');
      }
    }
    const id = `${slug(base)}-${sufijo}`;
    const titulo = (base || 'Video nuevo').slice(0, 200);
    await env.MEDIA.put(`entrada/${id}.mp4`, request.body, { httpMetadata: { contentType: 'video/mp4' } });
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO videos (id, titulo, estado, huella, en_nube, bytes) VALUES (?, ?, 'subido', ?, ?, ?)`).bind(id, titulo, huella || null, nube, largo),
      stmtAuditoria(env, usuario.id, 'crear', 'video', id, titulo),
    ]);
    return json({ id, titulo, estado: 'subido' }, 201);
  }
  return error(400, 'Tipo de archivo desconocido.');
}

// Sirve un documento de R2 (solo con sesión). Si no está en R2, cae a los archivos estáticos.
async function servirDocumento(request, env, ruta) {
  let clave;
  try { clave = decodeURIComponent(ruta.slice('/media/'.length)); } catch (e) { return error(400, 'Ruta inválida.'); }
  if (clave.includes('..')) return error(400, 'Ruta inválida.');
  const objeto = await env.MEDIA.get(clave);
  if (!objeto) return env.ASSETS.fetch(request);
  const cabeceras = new Headers({
    'content-type': objeto.httpMetadata?.contentType || 'application/octet-stream',
    'content-length': String(objeto.size),
    'content-disposition': 'inline',
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, max-age=300',
  });
  return new Response(request.method === 'HEAD' ? null : objeto.body, { headers: cabeceras });
}

// Descarta un video recién subido que no se guardó en ningún curso (el editor lo quitó o descartó los cambios).
async function descartarVideoSubido(env, usuario, id) {
  const v = await env.DB.prepare('SELECT id, titulo, estado FROM videos WHERE id = ?').bind(id).first();
  if (!v) return error(404, 'Video no encontrado.');
  if (v.estado !== 'subido') return error(409, 'Solo se pueden descartar videos que aún no se mandaron a convertir.');
  const enUso = await env.DB.prepare('SELECT curso_id FROM curso_videos WHERE video_id = ? UNION SELECT id FROM cursos WHERE video_id = ?').bind(id, id).first();
  if (enUso) return error(409, 'El video está asociado a un curso.');
  await env.MEDIA.delete(`entrada/${id}.mp4`);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM videos WHERE id = ?').bind(id),
    stmtAuditoria(env, usuario.id, 'borrar', 'video', id, v.titulo),
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
      if (ruta.startsWith('/media/documentos/')) {
        if (escritura) return error(405, 'Método no permitido.');
        if (!(await usuarioActual(request, env))) return error(401, 'Inicia sesión.');
        return await servirDocumento(request, env, ruta);
      }
      if (!ruta.startsWith('/api/')) return env.ASSETS.fetch(request);

      const partes = ruta.replace(/^\/api\/?/, '').split('/').filter(Boolean);
      const recurso = partes.shift();

      if (recurso === 'interno' && partes[0] === 'video' && request.method === 'POST') return await avisoConversion(request, env);
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
      if (seccion === 'archivos') return await subirArchivo(request, env, usuario, url);
      if (seccion === 'videos' && request.method === 'GET') return json(await listarVideos(env));
      if (seccion === 'videos' && request.method === 'DELETE' && partes[0]) return await descartarVideoSubido(env, usuario, partes[0]);
      return error(404, 'No encontrado.');
    } catch (e) {
      console.error(e);
      return error(500, 'Error interno.');
    }
  },
};
