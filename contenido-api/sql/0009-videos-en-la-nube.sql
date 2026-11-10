-- Videos convertidos en la nube (GitHub Actions + R2).
--   en_nube = 1: el video se convierte en GitHub Actions y se sirve desde el bucket público de videos (VIDEOS_URL).
--   en_nube = 0: video estático de la aplicación, o convertido con el convertidor local (desarrollo).
--   bytes: tamaño del MP4 original, para el cupo de almacenamiento gratuito.
ALTER TABLE videos ADD COLUMN en_nube INTEGER NOT NULL DEFAULT 0;
ALTER TABLE videos ADD COLUMN bytes INTEGER NOT NULL DEFAULT 0;
