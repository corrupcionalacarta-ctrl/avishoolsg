"""
AVI School - Digest unificado
==============================
Lee los ultimos dumps de Gmail/Classroom/SchoolNet, clasifica items con Gemini Flash,
arma HTML y envia por email.

Uso:
    python digest.py                    # corre todo y manda email
    python digest.py --no-email         # genera HTML pero no envia (preview)
    python digest.py --dry-run          # solo muestra qué items se procesarian, sin LLM
"""

import argparse
import glob
import json
import os
import sys
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

import notify

load_dotenv()


def _clean(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


GEMINI_API_KEY = _clean("GEMINI_API_KEY")
GEMINI_MODEL = _clean("GEMINI_MODEL", "gemini-2.5-flash")
OUTPUT_DIR = Path(_clean("OUTPUT_DIR", "."))


# ===== CARGA DE DUMPS =====

def latest_gmail_dump() -> dict | None:
    """Devuelve el dump de Gmail mas reciente."""
    files = sorted(glob.glob(str(OUTPUT_DIR / "gmail_dump_*.json")))
    if not files:
        return None
    return json.loads(Path(files[-1]).read_text(encoding="utf-8"))


def load_classroom_dump() -> dict | None:
    f = OUTPUT_DIR / "classroom_dump.json"
    if not f.exists():
        # Fallback a partial si no hay dump principal
        partials = sorted(glob.glob(str(OUTPUT_DIR / "classroom_dump_partial_*.json")))
        if partials:
            return json.loads(Path(partials[-1]).read_text(encoding="utf-8"))
        return None
    return json.loads(f.read_text(encoding="utf-8"))


def load_schoolnet_dump() -> dict | None:
    f = OUTPUT_DIR / "schoolnet_dump.json"
    if not f.exists():
        return None
    return json.loads(f.read_text(encoding="utf-8"))


# ===== NORMALIZACION =====

def normalize_items() -> list[dict]:
    """Junta items de los 3 sources en una lista plana con formato comun."""
    items = []

    # Gmail
    gmail = latest_gmail_dump()
    if gmail:
        for m in gmail.get("mails", []):
            items.append({
                "source": "gmail",
                "fecha": m.get("fecha", "")[:10],
                "titulo": m.get("asunto", ""),
                "autor": m.get("de", ""),
                "contenido": m.get("preview", "")[:600],
            })

    # Classroom
    classroom = load_classroom_dump()
    if classroom:
        for clase in classroom.get("clases", []):
            cname = clase.get("nombre", "")
            for tarea in clase.get("tareas", []):
                items.append({
                    "source": "classroom",
                    "fecha": tarea.get("fecha", tarea.get("publicado", "")),
                    "titulo": f"[{cname}] {tarea.get('titulo', '')}",
                    "autor": tarea.get("autor", ""),
                    "contenido": tarea.get("descripcion", "") or " | ".join(tarea.get("adjuntos", [])),
                })
            for anuncio in clase.get("anuncios", []):
                items.append({
                    "source": "classroom",
                    "fecha": anuncio.get("fecha", ""),
                    "titulo": f"[{cname}] Anuncio",
                    "autor": anuncio.get("autor", ""),
                    "contenido": anuncio.get("contenido", "")[:600],
                })

    # SchoolNet
    schoolnet = load_schoolnet_dump()
    if schoolnet:
        for nombre, sec in schoolnet.get("secciones", {}).items():
            for it in sec.get("items", []):
                if isinstance(it, dict):
                    items.append({
                        "source": "schoolnet",
                        "fecha": it.get("fecha", ""),
                        "titulo": f"[{nombre}] {it.get('titulo', it.get('descripcion', ''))}",
                        "autor": "",
                        "contenido": str(it)[:600],
                    })
                else:
                    items.append({
                        "source": "schoolnet",
                        "fecha": "",
                        "titulo": f"[{nombre}]",
                        "autor": "",
                        "contenido": str(it)[:600],
                    })

    return items


# ===== CLASIFICACION CON GEMINI =====

CLASSIFY_PROMPT = """Eres un asistente escolar para apoderados chilenos. Ayudas a Manuel y su señora con la agenda de sus hijos:
- Clemente Aravena, 11 años, 6°D, Colegio Georgian (Saint George)
- Raimundo Aravena, 9 años, 4°A, Colegio Georgian (Saint George)
Cuando puedas identificar a qué alumno corresponde un item, mencionalo por nombre en el detalle.

Hoy es {hoy} ({dia_semana}).
El proximo dia de clases es {proximo_dia_clases}.

Recibes items de Gmail, Google Classroom y SchoolNet. Tu tarea es clasificar, priorizar y generar un resumen ORIENTADO A LA ACCION.

REGLAS DE CLASIFICACION:
- urgente: requiere accion HOY o MAÑANA. Incluye:
  * Pruebas/controles en las proximas 48h
  * Tareas o trabajos que se entregan mañana
  * Autorizaciones, cartas o documentos por entregar mañana
  * Materiales o utiles que el alumno debe LLEVAR mañana
  * Reuniones o eventos mañana
- importante: requiere accion esta semana (hasta 7 dias). Incluye:
  * Pruebas/controles proximos 7 dias (con cuenta regresiva: "en 3 dias")
  * Trabajos o tareas con fecha esta semana
  * Documentos por firmar o entregar esta semana
  * Materiales o utiles a conseguir antes de una fecha
  * Reuniones de apoderados esta semana
- informativo: sin fecha de accion o ya pasado. Materiales de estudio, comunicados generales, temarios sin fecha definida.

DETECCION ESPECIAL (siempre extraer si aparece):
- utiles_mañana: lista de materiales/utiles que el alumno debe llevar al dia siguiente
- colacion: indicaciones especiales de colacion para eventos proximos
- autorizaciones: formularios o cartas que el apoderado debe firmar/entregar

RESUMEN EJECUTIVO: SIEMPRE enfocado en el dia siguiente ({proximo_dia_clases}).
Si no hay nada para mañana, menciona el evento mas proximo de la semana.
Formato: "MAÑANA [dia]: [accion1]. [accion2]. Esta semana: [eventos importantes]"

Responde SOLO con este JSON valido (sin markdown, sin texto extra):

{{
  "resumen_ejecutivo": "orientado al dia siguiente, maximo 3 frases",
  "urgentes": [{{"titulo": "...", "detalle": "descripcion clara de que hacer, cuando y como", "dia": "lunes|martes|..."}}],
  "importantes": [{{"titulo": "...", "detalle": "...", "dias_restantes": 0}}],
  "informativos": [{{"titulo": "...", "detalle": "..."}}],
  "fechas_proximas": [{{"fecha": "YYYY-MM-DD", "evento": "...", "asignatura": "...", "tipo": "prueba|entrega|reunion|evento"}}],
  "utiles_mañana": ["item1", "item2"],
  "colacion_especial": "",
  "autorizaciones_pendientes": [{{"titulo": "...", "fecha_limite": "..."}}]
}}

Items a clasificar:
{items_json}
"""


def classify_with_gemini(items: list[dict]) -> dict:
    """Llama a Gemini Flash con response_mime_type=json para asegurar JSON valido."""
    if not items:
        return {
            "resumen_ejecutivo": "Sin items para procesar.",
            "urgentes": [], "importantes": [], "informativos": [], "fechas_proximas": [],
        }
    if not GEMINI_API_KEY:
        print("[ERROR] Falta GEMINI_API_KEY en .env")
        sys.exit(1)

    client = genai.Client(api_key=GEMINI_API_KEY)
    now = datetime.now()
    dias_es = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
    dia_semana = dias_es[now.weekday()]
    # Próximo día de clases (saltar fin de semana)
    from datetime import timedelta
    proximo = now + timedelta(days=1)
    while proximo.weekday() >= 5:  # 5=sábado, 6=domingo
        proximo += timedelta(days=1)
    proximo_dia = dias_es[proximo.weekday()].capitalize()
    prompt = CLASSIFY_PROMPT.format(
        hoy=now.strftime("%Y-%m-%d"),
        dia_semana=dia_semana,
        proximo_dia_clases=f"{proximo_dia} {proximo.strftime('%d/%m')}",
        items_json=json.dumps(items, ensure_ascii=False, indent=2),
    )

    print(f"[INFO] Clasificando {len(items)} items con {GEMINI_MODEL}...")
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.2,
        ),
    )

    try:
        return json.loads(response.text)
    except json.JSONDecodeError as e:
        print(f"[ERROR] Gemini devolvio JSON invalido: {e}")
        # Guardar raw para debug
        raw_file = OUTPUT_DIR / f"digest_raw_{datetime.now().strftime('%H%M%S')}.txt"
        raw_file.write_text(response.text, encoding="utf-8")
        print(f"        Output crudo en: {raw_file}")
        sys.exit(1)


# ===== HTML BUILDER =====

HTML_TEMPLATE = """\
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 700px; margin: 0 auto; color: #1a1a1a;">

<h1 style="color: #003366; border-bottom: 2px solid #003366; padding-bottom: 8px;">AVI School Digest</h1>
<p style="color: #666; font-size: 13px;">{fecha} | {n_items} items procesados</p>

<div style="background: #f5f7fa; padding: 12px 16px; border-left: 4px solid #003366; margin-bottom: 24px;">
<strong>Resumen:</strong><br>{resumen}
</div>

{seccion_urgente}
{seccion_importante}
{seccion_fechas}
{seccion_informativo}

<hr style="border: 0; border-top: 1px solid #e0e0e0; margin-top: 32px;">
<p style="color: #888; font-size: 11px;">Generado automaticamente por AVI School. Sources: Gmail + Classroom + SchoolNet.</p>

</body>
</html>
"""


def section(title: str, color: str, icon: str, items: list[dict], detail_key: str = "detalle") -> str:
    if not items:
        return ""
    lis = ""
    for it in items:
        titulo = it.get("titulo", "(sin titulo)")
        detalle = it.get(detail_key, it.get("evento", ""))
        extra = ""
        if "fecha" in it and detail_key == "evento":
            extra = f' <span style="color:#888;">({it["fecha"]})</span>'
        if "asignatura" in it and it.get("asignatura"):
            extra += f' <span style="color:#666;">— {it["asignatura"]}</span>'
        lis += f'<li style="margin-bottom: 8px;"><strong>{titulo}</strong>{extra}<br><span style="color:#444;">{detalle}</span></li>'
    return f"""
<h2 style="color: {color}; margin-top: 24px;">{icon} {title}</h2>
<ul style="padding-left: 20px;">{lis}</ul>
"""


def build_html(classified: dict, n_items: int) -> str:
    return HTML_TEMPLATE.format(
        fecha=datetime.now().strftime("%A %d de %B %Y").capitalize(),
        n_items=n_items,
        resumen=classified.get("resumen_ejecutivo", ""),
        seccion_urgente=section("Urgente", "#c0392b", "🔴", classified.get("urgentes", [])),
        seccion_importante=section("Importante", "#d68910", "🟡", classified.get("importantes", [])),
        seccion_fechas=section("Próximas fechas", "#1f618d", "📅", classified.get("fechas_proximas", []),
                              detail_key="evento"),
        seccion_informativo=section("Informativo", "#566573", "📋", classified.get("informativos", [])),
    )


# ===== MAIN =====

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-email", action="store_true", help="No envia email, solo guarda HTML")
    parser.add_argument("--dry-run", action="store_true", help="Solo lista items sin llamar LLM ni enviar")
    args = parser.parse_args()

    items = normalize_items()
    print(f"[INFO] {len(items)} items consolidados de los 3 sources")

    if args.dry_run:
        print("\n--- ITEMS ---")
        for i, it in enumerate(items[:30]):
            print(f"  [{it['source']:9s}] {it['fecha'][:10]} | {it['titulo'][:80]}")
        if len(items) > 30:
            print(f"  ... y {len(items)-30} mas")
        return

    classified = classify_with_gemini(items)
    html = build_html(classified, len(items))

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    html_file = OUTPUT_DIR / f"digest_{timestamp}.html"
    html_file.write_text(html, encoding="utf-8")
    json_file = OUTPUT_DIR / f"digest_{timestamp}.json"
    json_file.write_text(json.dumps(classified, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[OK] HTML: {html_file}")
    print(f"[OK] JSON: {json_file}")

    print(f"\n>> Resumen: {classified.get('resumen_ejecutivo', '')}")
    print(f">> Urgentes:    {len(classified.get('urgentes', []))}")
    print(f">> Importantes: {len(classified.get('importantes', []))}")
    print(f">> Informativos:{len(classified.get('informativos', []))}")
    print(f">> Fechas prox: {len(classified.get('fechas_proximas', []))}")

    # Push a Supabase (no bloquea ni falla el pipeline si no esta configurado)
    from supabase_push import push_digest
    push_digest(classified, len(items), run_mode=os.getenv("RUN_MODE", "manual"))

    if args.no_email:
        print("\n[INFO] --no-email activo, no se envio")
        return

    subject = f"[AVI School] Digest {datetime.now().strftime('%d/%m %H:%M')}"
    if classified.get("urgentes"):
        subject = f"🔴 {subject} ({len(classified['urgentes'])} urgentes)"
    ok = notify.send_email(subject, html)
    print(f"\n[{'OK' if ok else 'FAIL'}] Email enviado")


if __name__ == "__main__":
    main()
