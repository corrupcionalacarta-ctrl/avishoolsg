"""
AVI School - Análisis IA predictivo por alumno
===============================================
Lee notas y anotaciones desde Supabase, genera análisis con Gemini,
y persiste el resultado en analisis_alumno.

Uso:
    python ai_analysis.py               # analiza ambos alumnos
    python ai_analysis.py clemente      # solo Clemente
    python ai_analysis.py raimundo      # solo Raimundo
"""

import json
import os
import re
import sys
from datetime import datetime, timedelta

from dotenv import load_dotenv
from supabase import create_client
from google import genai
from google.genai import types

load_dotenv()

ALUMNOS = [
    {"nombre": "Clemente Aravena", "slug": "clemente", "curso": "6°D"},
    {"nombre": "Raimundo Aravena", "slug": "raimundo",  "curso": "4°A"},
]

GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")


def get_sb():
    url = os.getenv("SUPABASE_URL", "")
    key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not url or not key:
        raise RuntimeError("Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY en .env")
    return create_client(url, key)


def fetch_context(sb, nombre: str) -> dict:
    """Lee todos los datos disponibles para el alumno desde Supabase."""
    hace90 = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
    hoy = datetime.now().strftime("%Y-%m-%d")
    en30 = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")

    notas = sb.table("notas").select(
        "asignatura, tipo, nota, promedio_curso, descripcion, fecha"
    ).ilike("alumno", f"%{nombre.split()[0]}%").execute().data or []

    anotaciones = sb.table("anotaciones").select(
        "tipo, titulo, descripcion, fecha, asignatura"
    ).ilike("alumno", f"%{nombre.split()[0]}%").gte("fecha", hace90).order(
        "fecha", desc=False
    ).execute().data or []

    fechas = sb.table("items_colegio").select(
        "titulo, fecha_evento, asignatura, detalle"
    ).eq("categoria", "fecha_proxima").gte("fecha_evento", hoy).lte(
        "fecha_evento", en30
    ).or_(f"alumno.ilike.%{nombre.split()[0]}%,alumno.is.null").order(
        "fecha_evento"
    ).execute().data or []

    # Análisis anterior (para detectar tendencias)
    prev = sb.table("analisis_alumno").select(
        "tendencia_academica, tendencia_conducta, nivel_alerta, generado_en"
    ).ilike("alumno", f"%{nombre.split()[0]}%").order(
        "generado_en", desc=True
    ).limit(1).execute().data or []

    return {
        "notas": notas,
        "anotaciones": anotaciones,
        "fechas_proximas": fechas,
        "analisis_previo": prev[0] if prev else None,
    }


def build_prompt(nombre: str, curso: str, ctx: dict) -> str:
    notas = ctx["notas"]
    anot  = ctx["anotaciones"]
    fechas = ctx["fechas_proximas"]
    prev  = ctx["analisis_previo"]

    # Resumen de notas por asignatura
    promedios = [n for n in notas if n.get("tipo") == "promedio" and n.get("nota")]
    pruebas   = [n for n in notas if n.get("tipo") == "prueba"   and n.get("nota")]

    notas_txt = ""
    for p in promedios:
        dif = ""
        if p.get("promedio_curso"):
            d = round((p["nota"] or 0) - p["promedio_curso"], 1)
            dif = f" (vs curso: {'+' if d >= 0 else ''}{d})"
        notas_txt += f"  - {p['asignatura']}: {p['nota']}{dif}\n"
    if pruebas:
        notas_txt += "  Evaluaciones individuales:\n"
        for p in pruebas:
            notas_txt += f"    · {p['descripcion']} [{p['asignatura']}]: {p['nota']}\n"

    pos  = [a for a in anot if a.get("tipo") == "positiva"]
    neg  = [a for a in anot if a.get("tipo") == "negativa"]
    obs  = [a for a in anot if a.get("tipo") == "observacion"]

    anot_txt = f"  Positivas: {len(pos)}  |  Negativas: {len(neg)}  |  Observaciones: {len(obs)}\n"
    for a in anot[-10:]:   # últimas 10
        icon = "✓" if a.get("tipo") == "positiva" else ("✗" if a.get("tipo") == "negativa" else "·")
        anot_txt += f"  {icon} [{a.get('fecha','')}] {a.get('titulo','')} — {a.get('descripcion','')}\n"

    fechas_txt = "\n".join(
        f"  - {f['fecha_evento']}: {f['titulo']} ({f.get('asignatura','') or f.get('detalle','')})"
        for f in fechas[:10]
    ) or "  Sin fechas próximas registradas"

    prev_txt = ""
    if prev:
        prev_txt = f"\nAnálisis anterior ({prev.get('generado_en','')[:10]}): académico={prev.get('tendencia_academica')} conducta={prev.get('tendencia_conducta')} alerta={prev.get('nivel_alerta')}"

    return f"""Eres un psicopedagogo experto. Analiza la situación escolar de {nombre}, {curso}, Colegio Saint George, Chile.

NOTAS ACTUALES:
{notas_txt or '  Sin notas registradas'}

CONDUCTA (últimos 90 días):
{anot_txt}

PRÓXIMAS EVALUACIONES (30 días):
{fechas_txt}
{prev_txt}

Genera un análisis JSON con esta estructura exacta (sin markdown, solo el JSON):
{{
  "resumen": "2-3 oraciones sobre la situación actual del alumno",
  "tendencia_academica": "mejorando" | "estable" | "descendiendo",
  "tendencia_conducta": "mejorando" | "estable" | "descendiendo",
  "nivel_alerta": "alto" | "medio" | "bajo",
  "prediccion": "1-2 oraciones prediciendo el cierre de semestre si continúa la tendencia actual",
  "alertas": [
    {{"titulo": "descripción concisa del riesgo", "prioridad": "alta" | "media" | "baja"}}
  ],
  "recomendaciones": [
    {{"accion": "acción concreta y específica para los apoderados"}}
  ]
}}

Criterios:
- nivel_alerta alto: promedio bajo 5.0 en algún ramo O 3+ anotaciones negativas recientes
- nivel_alerta medio: promedio 5.0-5.5 en algún ramo O 1-2 negativas recientes
- nivel_alerta bajo: todo sobre 5.5 y conducta positiva
- máximo 3 alertas y 3 recomendaciones, en orden de prioridad
- usa datos reales, no generalices
"""


def parse_gemini_json(text: str) -> dict:
    """Extrae el JSON de la respuesta de Gemini aunque tenga markdown."""
    # Strip markdown code blocks if present
    text = re.sub(r"```(?:json)?\s*", "", text).strip()
    text = text.rstrip("`").strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to extract first { ... } block
        m = re.search(r'\{[\s\S]+\}', text)
        if m:
            return json.loads(m.group(0))
        raise


def run_analysis(nombre: str, curso: str) -> bool:
    print(f"\n[INFO] ===== Analizando {nombre} ({curso}) =====")
    try:
        sb = get_sb()
        ctx = fetch_context(sb, nombre)

        print(f"[INFO] Datos: {len(ctx['notas'])} notas, {len(ctx['anotaciones'])} anotaciones, {len(ctx['fechas_proximas'])} fechas próximas")

        prompt = build_prompt(nombre, curso, ctx)

        client = genai.Client(api_key=os.getenv("GEMINI_API_KEY", ""))
        resp = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.3,
                max_output_tokens=1024,
            ),
        )
        raw = resp.text.strip()
        print(f"[INFO] Respuesta Gemini ({len(raw)} chars)")

        data = parse_gemini_json(raw)

        # Validate required fields
        for field in ["resumen", "tendencia_academica", "tendencia_conducta", "nivel_alerta"]:
            if field not in data:
                raise ValueError(f"Campo faltante en respuesta: {field}")

        # Normalizar
        tendencias_ok = {"mejorando", "estable", "descendiendo"}
        alertas_ok    = {"alto", "medio", "bajo"}
        if data["tendencia_academica"] not in tendencias_ok:
            data["tendencia_academica"] = "estable"
        if data["tendencia_conducta"] not in tendencias_ok:
            data["tendencia_conducta"] = "estable"
        if data["nivel_alerta"] not in alertas_ok:
            data["nivel_alerta"] = "medio"

        row = {
            "alumno":               nombre,
            "resumen":              data.get("resumen", ""),
            "tendencia_academica":  data["tendencia_academica"],
            "tendencia_conducta":   data["tendencia_conducta"],
            "nivel_alerta":         data["nivel_alerta"],
            "prediccion":           data.get("prediccion", ""),
            "alertas":              data.get("alertas", []),
            "recomendaciones":      data.get("recomendaciones", []),
            "generado_en":          datetime.now().isoformat(),
        }

        # Keep last 7 analyses, insert new one
        old = sb.table("analisis_alumno").select("id, generado_en").ilike(
            "alumno", f"%{nombre.split()[0]}%"
        ).order("generado_en", desc=True).limit(10).execute().data or []

        if len(old) >= 7:
            ids_to_delete = [r["id"] for r in old[6:]]
            sb.table("analisis_alumno").delete().in_("id", ids_to_delete).execute()

        sb.table("analisis_alumno").insert(row).execute()

        print(f"[OK] Análisis guardado:")
        print(f"     Académico: {row['tendencia_academica']} | Conducta: {row['tendencia_conducta']} | Alerta: {row['nivel_alerta']}")
        print(f"     {row['resumen'][:120]}...")
        return True

    except Exception as e:
        print(f"[ERROR] {nombre}: {e}")
        return False


if __name__ == "__main__":
    filtro = sys.argv[1].lower() if len(sys.argv) > 1 else None

    if not os.getenv("GEMINI_API_KEY"):
        print("[ERROR] Falta GEMINI_API_KEY en .env")
        sys.exit(1)

    # Verify table exists
    try:
        get_sb().table("analisis_alumno").select("id").limit(1).execute()
    except Exception as e:
        if "PGRST205" in str(e) or "schema cache" in str(e):
            print("[ERROR] La tabla 'analisis_alumno' no existe en Supabase.")
            print("        Ve a Supabase → SQL Editor y ejecuta el contenido de create_tables.sql")
            sys.exit(1)

    ok = 0
    for a in ALUMNOS:
        if filtro and filtro not in a["slug"]:
            continue
        if run_analysis(a["nombre"], a["curso"]):
            ok += 1

    print(f"\n[OK] Análisis completado: {ok}/{len([a for a in ALUMNOS if not filtro or filtro in a['slug']])} alumnos")
