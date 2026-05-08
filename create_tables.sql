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

-- Materiales adjuntos de cada tarea de Classroom (PDFs, Docs, Slides, etc.)
CREATE TABLE IF NOT EXISTS classroom_materiales (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alumno         text NOT NULL,
  curso          text NOT NULL,
  tarea_titulo   text NOT NULL,
  tarea_link     text,
  nombre         text NOT NULL,
  url            text NOT NULL,
  tipo           text CHECK (tipo IN ('documento','presentacion','hoja','formulario','video','pdf','drive','sitio','archivo')),
  actualizado_en timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_classroom_mat_alumno ON classroom_materiales (alumno);
CREATE INDEX IF NOT EXISTS idx_classroom_mat_curso  ON classroom_materiales (curso);


-- Log de acciones cumplidas por el padre (para no volver a solicitar lo mismo)
CREATE TABLE IF NOT EXISTS acciones_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_titulo    text NOT NULL,
  item_tipo      text DEFAULT 'urgente',
  alumno         text,
  porcentaje     int DEFAULT 100,
  nota_padre     text,
  registrado_por text DEFAULT 'padre',
  created_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_acciones_log_titulo  ON acciones_log (item_titulo);
CREATE INDEX IF NOT EXISTS idx_acciones_log_created ON acciones_log (created_at DESC);
