-- Varios videos por curso, cada uno con título, descripción y documentos propios (opcionales).
-- cursos.video_id se conserva como "video principal" (el primero) por compatibilidad.
CREATE TABLE curso_videos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  curso_id    TEXT    NOT NULL REFERENCES cursos(id) ON DELETE CASCADE,
  video_id    TEXT    NOT NULL REFERENCES videos(id),
  orden       INTEGER NOT NULL DEFAULT 0,
  titulo      TEXT    NOT NULL DEFAULT '',
  descripcion TEXT    NOT NULL DEFAULT '',
  documentos  TEXT    NOT NULL DEFAULT '[]'      -- JSON: [{"titulo": "...", "archivo": "..."}]
);
CREATE INDEX idx_curso_videos_curso ON curso_videos(curso_id, orden);

INSERT INTO curso_videos (curso_id, video_id, orden)
  SELECT id, video_id, 1 FROM cursos WHERE video_id IS NOT NULL;
