-- Agrega el rol 'usuario' (personal que solo consulta el aplicativo).
-- SQLite no permite cambiar un CHECK: se reconstruye la tabla conservando los ids.
-- sesiones y auditoria apuntan a usuarios(id) con claves foráneas activas, así que se
-- vacían un momento: las sesiones se cierran (todos deben iniciar sesión de nuevo) y la
-- auditoría se resguarda y se restaura tal cual.
CREATE TABLE usuarios_nueva (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario     TEXT    NOT NULL UNIQUE,
  clave_hash  TEXT    NOT NULL,
  clave_sal   TEXT    NOT NULL,
  rol         TEXT    NOT NULL DEFAULT 'usuario' CHECK (rol IN ('admin', 'editor', 'usuario')),
  activo      INTEGER NOT NULL DEFAULT 1,
  creado      TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO usuarios_nueva (id, usuario, clave_hash, clave_sal, rol, activo, creado)
  SELECT id, usuario, clave_hash, clave_sal, rol, activo, creado FROM usuarios;

CREATE TABLE auditoria_resguardo AS SELECT id, usuario_id, accion, entidad, referencia, detalle, fecha FROM auditoria;
DELETE FROM auditoria;
DELETE FROM sesiones;

DROP TABLE usuarios;
ALTER TABLE usuarios_nueva RENAME TO usuarios;

INSERT INTO auditoria (id, usuario_id, accion, entidad, referencia, detalle, fecha)
  SELECT id, usuario_id, accion, entidad, referencia, detalle, fecha FROM auditoria_resguardo;
DROP TABLE auditoria_resguardo;
