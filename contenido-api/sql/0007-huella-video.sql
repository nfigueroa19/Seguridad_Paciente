-- Huella SHA-256 del MP4 original: permite reconocer un video ya subido y no convertirlo dos veces.
ALTER TABLE videos ADD COLUMN huella TEXT;
CREATE INDEX idx_videos_huella ON videos(huella);
