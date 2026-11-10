-- Datos de partida tomados de app-plataforma/media/cursos.json (2026-11-09).
-- Los usuarios NO se siembran aquí: se crean con la clave hasheada al configurar el Worker.

INSERT INTO videos (id, titulo, estado) VALUES
  ('decalogo-cartilla-de-seguridad-del-paciente-dirigida-al-paciente', 'DECALOGO CARTILLA DE SEGURIDAD DEL PACIENTE DIRIGIDA AL PACIENTE', 'listo'),
  ('identificacion-del-paciente', 'identificacion del paciente', 'listo'),
  ('nociciero-sp', 'nociciero sp', 'listo'),
  ('video-epicce', 'video EPICCE', 'listo');

INSERT INTO cursos (id, titulo, resumen, orden, video_id) VALUES
  ('curso-1', 'Curso 1', 'Contenido por definir.', 1, 'decalogo-cartilla-de-seguridad-del-paciente-dirigida-al-paciente'),
  ('curso-2', 'Curso 2', 'Contenido por definir.', 2, 'identificacion-del-paciente'),
  ('curso-3', 'Curso 3', 'Contenido por definir.', 3, 'nociciero-sp'),
  ('curso-4', 'Curso 4', 'Contenido por definir.', 4, 'video-epicce');

INSERT INTO curso_parrafos (curso_id, orden, texto) VALUES
  ('curso-1', 1, 'Aquí irá la información en texto del curso.'),
  ('curso-2', 1, 'Aquí irá la información en texto del curso.'),
  ('curso-3', 1, 'Aquí irá la información en texto del curso.'),
  ('curso-4', 1, 'Aquí irá la información en texto del curso.');
