-- Esquema de contenido de la plataforma Seguridad del Paciente.
-- Pensado para ser portable: D1 (SQLite) hoy, SQL Server en la intranet.
-- Solo tipos simples (TEXT/INTEGER), sin funciones propias de SQLite.

CREATE TABLE usuarios (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario     TEXT    NOT NULL UNIQUE,
  clave_hash TEXT    NOT NULL,
  clave_sal   TEXT    NOT NULL,
  rol         TEXT    NOT NULL DEFAULT 'editor' CHECK (rol IN ('admin', 'editor')),
  activo      INTEGER NOT NULL DEFAULT 1,
  creado      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sesiones (
  token_hash  TEXT    PRIMARY KEY,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
  expira      TEXT    NOT NULL,
  creado      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Textos sueltos del sitio (títulos de portada, encabezados de sección, etc.)
CREATE TABLE textos_sitio (
  clave       TEXT PRIMARY KEY,
  valor       TEXT NOT NULL,
  descripcion TEXT,
  actualizado TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE videos (
  id          TEXT PRIMARY KEY,           -- carpeta en media/videos/<id>/
  titulo      TEXT NOT NULL,
  estado      TEXT NOT NULL DEFAULT 'listo' CHECK (estado IN ('subido', 'procesando', 'listo', 'error')),
  creado      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE cursos (
  id          TEXT PRIMARY KEY,           -- p. ej. 'curso-1'
  titulo      TEXT    NOT NULL,
  resumen     TEXT    NOT NULL DEFAULT '',
  orden       INTEGER NOT NULL DEFAULT 0,
  publicado   INTEGER NOT NULL DEFAULT 1,
  video_id    TEXT REFERENCES videos(id),
  actualizado TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE curso_parrafos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  curso_id    TEXT    NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
  orden       INTEGER NOT NULL DEFAULT 0,
  texto       TEXT    NOT NULL
);

CREATE TABLE curso_documentos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  curso_id    TEXT    NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
  orden       INTEGER NOT NULL DEFAULT 0,
  titulo      TEXT    NOT NULL,
  url         TEXT    NOT NULL
);

CREATE TABLE auditoria (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id  INTEGER REFERENCES usuarios(id),
  accion      TEXT NOT NULL,              -- crear / editar / borrar / ingreso
  entidad     TEXT NOT NULL,              -- curso, video, texto_sitio, usuario…
  referencia  TEXT,
  detalle     TEXT,
  fecha       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_parrafos_curso   ON curso_parrafos(curso_id, orden);
CREATE INDEX idx_documentos_curso ON curso_documentos(curso_id, orden);
CREATE INDEX idx_sesiones_usuario ON sesiones(usuario_id);
CREATE INDEX idx_auditoria_fecha  ON auditoria(fecha);
