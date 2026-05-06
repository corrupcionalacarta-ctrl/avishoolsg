-- AVI School: tabla analisis_alumno
-- Ejecutar en Supabase → SQL Editor

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
