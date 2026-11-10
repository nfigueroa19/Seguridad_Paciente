-- El nombre y el cargo del chip de la barra superior ahora salen de la sesión, no son textos editables.
DELETE FROM textos_sitio WHERE clave IN ('superior.usuario', 'superior.cargo');
