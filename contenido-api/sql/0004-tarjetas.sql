-- Tarjetas editables (módulos de Inicio y tarjetas de las demás páginas).
-- Las zonas (columna zona) están definidas en contenido-api/src/index.js (ZONAS) y en
-- los data-zona de app-plataforma/index.html.
CREATE TABLE tarjetas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  zona        TEXT    NOT NULL,
  orden       INTEGER NOT NULL DEFAULT 0,
  icono       TEXT    NOT NULL DEFAULT '',
  titulo      TEXT    NOT NULL,
  texto       TEXT    NOT NULL DEFAULT '',
  boton       TEXT    NOT NULL DEFAULT '',
  enlace      TEXT    NOT NULL DEFAULT '',
  publicado   INTEGER NOT NULL DEFAULT 1,
  actualizado TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tarjetas_zona ON tarjetas(zona, orden);

INSERT INTO tarjetas (zona, orden, icono, titulo, texto, boton, enlace) VALUES
  ('inicio-modulos', 1, '🔎', 'Conoce', 'Consulta rápida de los conceptos esenciales de Seguridad del Paciente.', 'Entrar', '#conoce'),
  ('inicio-modulos', 2, '🎮', 'Practica con SIMULA', 'Juegos interactivos que representan los lineamientos de seguridad.', 'Entrar', '#simula'),
  ('inicio-modulos', 3, '🧭', 'Pon a prueba tu criterio en DETECTA', 'Casos y decisiones frente a riesgos reales.', 'Entrar', '#detecta'),
  ('inicio-modulos', 4, '🎓', 'Aprende', 'Mis cursos y paquetes educativos asignados según tus resultados en los juegos.', 'Entrar', '#aprende');
