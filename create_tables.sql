-- AVI School: migraciones de tablas
-- Ejecutar en Supabase → SQL Editor

-- Columnas nuevas en tabla asistencia (si no existen)
ALTER TABLE asistencia ADD COLUMN IF NOT EXISTS inasistencias        int;
ALTER TABLE asistencia ADD COLUMN IF NOT EXISTS atrasos              int;
ALTER TABLE asistencia ADD COLUMN IF NOT EXISTS inasistencias_detalle jsonb DEFAULT '[]'::jsonb;
ALTER TABLE asistencia ADD COLUMN IF NOT EXISTS atrasos_detalle      jsonb DEFAULT '[]'::jsonb;



CREATE TABLE IF NOT EXISTS analisis_alumno (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alumno                text NOT NULL,
  resumen               text,
  tendencia_academica   text CHECK (tendencia_academica IN ('mejorando','estable','descendiendo')),
  tendencia_conducta    text CHECK (tendencia_conducta IN ('mejorando','estable','descendiendo')),
  nivel_alerta          text CHECK (nivel_alerta IN ('alto','medio','bajo')),
  prediccion            text,
  alertas               jsonb DEFAULT '[]'::jsonb,
  recomendaciones       jsonb DEFAULT '[]'::jsonb,
  generado_en           timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analisis_alumno_alumno    ON analisis_alumno (alumno);
CREATE INDEX IF NOT EXISTS idx_analisis_alumno_generado  ON analisis_alumno (generado_en DESC);


-- Tabla Google Classroom
CREATE TABLE IF NOT EXISTS classroom (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alumno         text NOT NULL,
  curso          text NOT NULL,
  titulo         text NOT NULL,
  tipo           text CHECK (tipo IN ('tarea','anuncio','material','pregunta')),
  fecha_entrega  date,
  estado         text CHECK (estado IN ('pendiente','entregado','atrasado','calificado','devuelto','informativo')),
  calificacion   text,
  link           text,
  descripcion    text,
  actualizado_en timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_classroom_alumno   ON classroom (alumno);
CREATE INDEX IF NOT EXISTS idx_classroom_fecha    ON classroom (fecha_entrega);
CREATE INDEX IF NOT EXISTS idx_classroom_estado   ON classroom (estado);
