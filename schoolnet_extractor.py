"""
AVI School - Extractor multi-source (SchoolNet + Google Classroom)
==================================================================
Optimizado para minimizar pasos/tokens:
- Sesion persistente del navegador (login una sola vez, 2FA solo la primera)
- Procesa UNA clase de Classroom por corrida (--class-index N)
- Acumula resultados en classroom_dump.json con merge
- Prompts ultra-concisos: NO Ver material, NO todo.md, NO Personas

Uso:
    # Listar clases disponibles (rapido, sin entrar a ninguna)
    python schoolnet_extractor.py --list-classes

    # Procesar una clase especifica (0-indexed)
    python schoolnet_extractor.py --class-index 0
    python schoolnet_extractor.py --class-index 1
    ...

    # Procesar SchoolNet completo (un source distinto)
    python schoolnet_extractor.py --only schoolnet

    # Continuar con la siguiente clase no procesada
    python schoolnet_extractor.py --continue-classroom
"""

import argparse
import asyncio
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

from browser_use import Agent, BrowserProfile, BrowserSession
from browser_use.llm import ChatGoogle
from dotenv import load_dotenv

load_dotenv()


def _clean(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


GEMINI_API_KEY = _clean("GEMINI_API_KEY")
GEMINI_MODEL = _clean("GEMINI_MODEL", "gemini-2.5-flash")
HEADLESS = _clean("HEADLESS", "false").lower() == "true"
OUTPUT_DIR = Path(_clean("OUTPUT_DIR", "."))

# Carpeta para sesion persistente del navegador (cookies, login)
BROWSER_DATA_DIR = OUTPUT_DIR / ".browser_session"
BROWSER_DATA_DIR.mkdir(exist_ok=True)

# Validacion del modelo
if not re.match(r"^[a-zA-Z0-9.\-]+$", GEMINI_MODEL):
    print(f"[ERROR] GEMINI_MODEL='{GEMINI_MODEL[:30]}...' tiene caracteres invalidos.")
    sys.exit(1)
if GEMINI_API_KEY and not GEMINI_API_KEY.startswith("AIza"):
    print(f"[WARN] GEMINI_API_KEY no empieza con 'AIza' - puede estar mal pegada.")

# Archivos de estado/dump persistentes
CLASSROOM_DUMP = OUTPUT_DIR / "classroom_dump.json"
CLASSROOM_STATE = OUTPUT_DIR / ".classroom_state.json"
SCHOOLNET_DUMP = OUTPUT_DIR / "schoolnet_dump.json"


# ===== DEFINICIONES DE TAREAS =====

CLASSROOM_LIST_TASK = """
Tarea: extraer la lista de TODAS las clases visibles en Google Classroom.

Pasos:
1. Navega a https://classroom.google.com
2. Loguea con cuenta "{user}" y password (sensitive: classroom_password). Si pide 2FA, espera 60s.
3. Una vez en el dashboard, extrae el nombre Y URL de cada clase.

Devuelve SOLO un JSON con esta estructura (nada de prosa, nada de markdown):
{{"clases": [{{"nombre": "...", "url": "https://classroom.google.com/c/..."}}, ...]}}
"""

CLASSROOM_SINGLE_CLASS_TASK = """
Tarea: extraer info de UNA clase de Google Classroom.

Pasos OBLIGATORIOS (no agregues mas):
1. Navega DIRECTO a {class_url}
2. Si te pide login, loguea con "{user}" y password (sensitive: classroom_password). Espera 60s si pide 2FA.
3. Click en pestaña "Trabajo de clase". Extrae lista visible de items: titulo, tipo (material/tarea), fecha, autor.
   NO entres a "Ver material". NO expandas items individuales. SOLO lo que se ve en el listado.
4. Click en pestaña "Tablon" (o "Novedades"). Extrae los anuncios visibles: fecha, autor, contenido.
5. Llama a "done" con el JSON final.

REGLAS DURAS:
- NO crees archivos todo.md ni de tracking. Solo navega y extrae.
- NO entres a Personas (los profesores ya aparecen como autores).
- NO uses "Ver material" ni clicks innecesarios.
- Tu respuesta final DEBE ser SOLO este JSON valido (sin markdown, sin texto):

{{
  "nombre": "{class_name}",
  "url": "{class_url}",
  "tareas": [
    {{"titulo": "...", "tipo": "material|tarea", "fecha": "...", "autor": "..."}}
  ],
  "anuncios": [
    {{"fecha": "...", "autor": "...", "contenido": "..."}}
  ]
}}
"""

SCHOOLNET_TASK = """
Tarea: extraer info de SchoolNet, plataforma escolar chilena.

Pasos:
1. Navega a {url}
2. Loguea con usuario "{user}" y password (sensitive: schoolnet_password).
3. Identifica las secciones del menu (notas, tareas, asistencia, comunicaciones, calendario, agenda).
4. Para cada seccion: navega y extrae el contenido visible. NO expandas detalles.
5. Llama a "done" con el JSON final.

REGLAS DURAS:
- NO crees todo.md. NO envies formularios. NO cambies password.
- Tu respuesta final DEBE ser SOLO este JSON valido:

{{
  "extraido_en": "ISO timestamp",
  "secciones": {{
    "<nombre>": {{"items": [...], "url": "..."}}
  }}
}}
"""

SCHOOLNET_GRADES_TASK = """
Tarea: extraer información completa de SchoolNet para DOS alumnos: Clemente Aravena (6°D) y Raimundo Aravena (4°A).

Pasos:
1. Navega a {url}
2. Loguea con usuario "{user}" y password (sensitive: schoolnet_password).
3. Si hay selector de alumno, extrae la info de Clemente primero, luego cambia a Raimundo.
4. Para CADA alumno extrae:
   a) NOTAS / CALIFICACIONES: todas las notas visibles por asignatura, tipo, valor, promedio del curso, descripción, fecha.
   b) ANOTACIONES / CONDUCTA / LIBRO DE CLASES: fecha, tipo (positiva/negativa/observación), descripción, asignatura.
   c) AGENDA / TAREAS PENDIENTES: fecha, descripción, asignatura.
   d) HORARIO DE CLASES si está disponible: día, hora, asignatura, sala.
   e) ASISTENCIA: % asistencia general si está visible.
   f) COMUNICACIONES / CIRCULARES recientes: título, fecha, contenido breve.
5. Llama a "done" con el JSON final.

REGLAS DURAS:
- NO crees archivos. NO envíes formularios. NO cambies nada.
- Extrae TODO lo que veas en pantalla, no omitas datos.
- Si una sección no tiene datos, deja el array vacío.
- Tu respuesta DEBE ser SOLO este JSON válido (sin markdown):

{{
  "extraido_en": "ISO timestamp",
  "alumnos": [
    {{
      "nombre": "Clemente Aravena",
      "curso": "6D",
      "asistencia_pct": null,
      "notas": [
        {{
          "asignatura": "...",
          "tipo": "prueba|trabajo|promedio|tarea|otro",
          "nota": 6.5,
          "promedio_curso": 5.8,
          "descripcion": "...",
          "fecha": "YYYY-MM-DD o descriptiva"
        }}
      ],
      "anotaciones": [
        {{
          "fecha": "YYYY-MM-DD o descriptiva",
          "tipo": "positiva|negativa|observacion",
          "descripcion": "...",
          "asignatura": "..."
        }}
      ],
      "agenda": [
        {{
          "fecha": "YYYY-MM-DD",
          "descripcion": "...",
          "asignatura": "..."
        }}
      ],
      "horario": [
        {{
          "dia": "lunes|martes|...",
          "hora": "08:00-08:45",
          "asignatura": "...",
          "sala": "..."
        }}
      ],
      "comunicaciones": [
        {{
          "fecha": "...",
          "titulo": "...",
          "resumen": "..."
        }}
      ]
    }},
    {{
      "nombre": "Raimundo Aravena",
      "curso": "4A",
      "asistencia_pct": null,
      "notas": [],
      "anotaciones": [],
      "agenda": [],
      "horario": [],
      "comunicaciones": []
    }}
  ]
}}
"""


def make_llm():
    if not GEMINI_API_KEY:
        print("[ERROR] Falta GEMINI_API_KEY en .env (https://aistudio.google.com/apikey)")
        sys.exit(1)
    return ChatGoogle(model=GEMINI_MODEL, api_key=GEMINI_API_KEY, temperature=0.1)


def make_browser_session():
    """Sesion persistente: la cookie del login Google sobrevive entre corridas."""
    profile = BrowserProfile(
        headless=HEADLESS,
        user_data_dir=str(BROWSER_DATA_DIR),
        keep_alive=True,
        timeout=60000,
    )
    return BrowserSession(browser_profile=profile, is_local=True)


def parse_json_from_output(text: str) -> dict | None:
    """Busca y parsea JSON desde el output del agente."""
    if not text:
        return None
    start = text.find("{")
    end = text.rfind("}") + 1
    if start < 0 or end <= start:
        return None
    try:
        return json.loads(text[start:end])
    except json.JSONDecodeError:
        return None


def load_state() -> dict:
    if CLASSROOM_STATE.exists():
        return json.loads(CLASSROOM_STATE.read_text(encoding="utf-8"))
    return {"clases_lista": [], "clases_procesadas": []}


def save_state(state: dict):
    CLASSROOM_STATE.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")


def load_dump() -> dict:
    if CLASSROOM_DUMP.exists():
        return json.loads(CLASSROOM_DUMP.read_text(encoding="utf-8"))
    return {"cuenta": _clean("CLASSROOM_USER"), "actualizado": None, "clases": []}


def save_dump(dump: dict):
    dump["actualizado"] = datetime.now().isoformat()
    CLASSROOM_DUMP.write_text(json.dumps(dump, indent=2, ensure_ascii=False), encoding="utf-8")


def merge_class_into_dump(class_data: dict):
    """Agrega o reemplaza una clase en el dump por URL."""
    dump = load_dump()
    url = class_data.get("url")
    dump["clases"] = [c for c in dump["clases"] if c.get("url") != url]
    dump["clases"].append(class_data)
    save_dump(dump)


# ===== ACCIONES =====

async def list_classroom_classes(llm) -> list[dict]:
    """Login + extrae lista de clases. Guarda en .classroom_state.json."""
    user = _clean("CLASSROOM_USER")
    password = _clean("CLASSROOM_PASS")
    if not all([user, password]):
        print("[ERROR] Faltan CLASSROOM_USER o CLASSROOM_PASS en .env")
        sys.exit(1)

    session = make_browser_session()
    agent = Agent(
        task=CLASSROOM_LIST_TASK.format(user=user),
        llm=llm,
        browser_session=session,
        sensitive_data={"classroom_password": password},
    )
    print("[INFO] Listando clases de Classroom (toma ~1 min, login + 2FA si aplica)")
    try:
        result = await agent.run(max_steps=30)
        output = result.final_result() if hasattr(result, "final_result") else str(result)
        parsed = parse_json_from_output(output)
        if parsed and "clases" in parsed:
            state = load_state()
            state["clases_lista"] = parsed["clases"]
            save_state(state)
            print(f"[OK] {len(parsed['clases'])} clases guardadas en {CLASSROOM_STATE}")
            for i, c in enumerate(parsed["clases"]):
                marker = "✓" if any(p == c["url"] for p in state["clases_procesadas"]) else " "
                print(f"   [{marker}] {i:2d}. {c['nombre']}")
            return parsed["clases"]
        else:
            print("[ERROR] No se pudo parsear lista de clases. Output crudo:")
            print(output[:500])
            return []
    finally:
        await session.stop()


async def extract_one_class(class_index: int, llm):
    """Procesa UNA clase por indice."""
    state = load_state()
    if not state["clases_lista"]:
        print("[ERROR] No hay lista de clases. Corre primero: --list-classes")
        sys.exit(1)
    if class_index >= len(state["clases_lista"]):
        print(f"[ERROR] indice {class_index} fuera de rango (hay {len(state['clases_lista'])} clases)")
        sys.exit(1)

    clase = state["clases_lista"][class_index]
    user = _clean("CLASSROOM_USER")
    password = _clean("CLASSROOM_PASS")

    print(f"\n{'='*60}")
    print(f"Clase {class_index}: {clase['nombre']}")
    print(f"URL: {clase['url']}")
    print(f"{'='*60}")

    session = make_browser_session()
    agent = Agent(
        task=CLASSROOM_SINGLE_CLASS_TASK.format(
            class_url=clase["url"],
            class_name=clase["nombre"],
            user=user,
        ),
        llm=llm,
        browser_session=session,
        sensitive_data={"classroom_password": password},
    )

    try:
        result = await agent.run(max_steps=40)
        output = result.final_result() if hasattr(result, "final_result") else str(result)
        parsed = parse_json_from_output(output)
        if parsed:
            merge_class_into_dump(parsed)
            state["clases_procesadas"] = list(set(state["clases_procesadas"] + [clase["url"]]))
            save_state(state)
            print(f"\n[OK] Clase guardada en {CLASSROOM_DUMP}")
            print(f"     Tareas: {len(parsed.get('tareas', []))}")
            print(f"     Anuncios: {len(parsed.get('anuncios', []))}")
        else:
            raw_file = OUTPUT_DIR / f"classroom_class{class_index}_raw_{datetime.now().strftime('%H%M%S')}.txt"
            raw_file.write_text(output or "(empty)", encoding="utf-8")
            print(f"\n[WARN] No se parseo JSON. Output crudo: {raw_file}")
    finally:
        await session.stop()


async def continue_classroom(llm, max_per_run: int = 1):
    """Procesa hasta max_per_run clases pendientes."""
    state = load_state()
    if not state["clases_lista"]:
        print("[INFO] No hay lista. Listando primero...")
        await list_classroom_classes(llm)
        state = load_state()

    procesadas = set(state["clases_procesadas"])
    pendientes = [(i, c) for i, c in enumerate(state["clases_lista"]) if c["url"] not in procesadas]
    if not pendientes:
        print("[OK] Todas las clases procesadas.")
        return

    print(f"[INFO] {len(pendientes)} pendientes. Procesando hasta {max_per_run} ahora.")
    for n, (idx, clase) in enumerate(pendientes[:max_per_run], 1):
        print(f"\n[{n}/{min(max_per_run, len(pendientes))}] Iniciando clase {idx}: {clase['nombre']}")
        try:
            await extract_one_class(idx, llm)
        except Exception as e:
            print(f"[ERROR] Clase {idx} fallo: {e}")
            continue


async def extract_schoolnet(llm):
    """Procesa SchoolNet completo en una corrida."""
    url = _clean("SCHOOLNET_URL")
    user = _clean("SCHOOLNET_USER")
    password = _clean("SCHOOLNET_PASS")
    if not all([url, user, password]):
        print("[ERROR] Faltan SCHOOLNET_URL, SCHOOLNET_USER o SCHOOLNET_PASS en .env")
        sys.exit(1)

    session = make_browser_session()
    agent = Agent(
        task=SCHOOLNET_TASK.format(url=url, user=user),
        llm=llm,
        browser_session=session,
        sensitive_data={"schoolnet_password": password},
    )
    print(f"[INFO] Procesando SchoolNet ({url})")
    try:
        result = await agent.run(max_steps=60)
        # browser_use 0.12+: intentar varias formas de obtener el output
        output = None
        if hasattr(result, "final_result") and callable(result.final_result):
            output = result.final_result()
        # Si final_result no tiene JSON, buscar en extracted_content
        if output and not parse_json_from_output(output):
            if hasattr(result, "extracted_content") and callable(result.extracted_content):
                extracted = result.extracted_content()
                if extracted:
                    combined = " ".join(str(e) for e in extracted)
                    if parse_json_from_output(combined):
                        output = combined
        if not output:
            output = str(result)
        parsed = parse_json_from_output(output)
        if parsed:
            SCHOOLNET_DUMP.write_text(json.dumps(parsed, indent=2, ensure_ascii=False), encoding="utf-8")
            print(f"[OK] Guardado en {SCHOOLNET_DUMP}")
        else:
            raw = OUTPUT_DIR / f"schoolnet_raw_{datetime.now().strftime('%H%M%S')}.txt"
            raw.write_text(output or "", encoding="utf-8")
            print(f"[WARN] Sin JSON. Crudo: {raw}")
    finally:
        await session.stop()


async def extract_schoolnet_grades(llm):
    """Extrae notas, anotaciones y agenda de SchoolNet. Se corre 1 vez al día."""
    url = _clean("SCHOOLNET_URL")
    user = _clean("SCHOOLNET_USER")
    password = _clean("SCHOOLNET_PASS")
    alumno = _clean("ALUMNO_NOMBRE", "AVI")
    if not all([url, user, password]):
        print("[ERROR] Faltan SCHOOLNET_URL, SCHOOLNET_USER o SCHOOLNET_PASS en .env")
        sys.exit(1)

    session = make_browser_session()
    agent = Agent(
        task=SCHOOLNET_GRADES_TASK.format(url=url, user=user, alumno=alumno),
        llm=llm,
        browser_session=session,
        sensitive_data={"schoolnet_password": password},
    )
    print(f"[INFO] Extrayendo notas y anotaciones de SchoolNet para {alumno}...")
    try:
        result = await agent.run(max_steps=80)
        output = result.final_result() if hasattr(result, "final_result") else str(result)
        parsed = parse_json_from_output(output)
        if parsed:
            grades_file = OUTPUT_DIR / f"schoolnet_grades_{datetime.now().strftime('%Y%m%d')}.json"
            grades_file.write_text(json.dumps(parsed, indent=2, ensure_ascii=False), encoding="utf-8")
            print(f"[OK] Notas guardadas en {grades_file}")
            print(f"     Notas:       {len(parsed.get('notas', []))}")
            print(f"     Anotaciones: {len(parsed.get('anotaciones', []))}")
            print(f"     Agenda:      {len(parsed.get('agenda', []))}")

            # Push a Supabase
            from supabase_push import push_grades
            push_grades(parsed)
        else:
            raw = OUTPUT_DIR / f"schoolnet_grades_raw_{datetime.now().strftime('%H%M%S')}.txt"
            raw.write_text(output or "", encoding="utf-8")
            print(f"[WARN] Sin JSON. Crudo: {raw}")
    finally:
        await session.stop()


# ===== MAIN =====

async def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--list-classes", action="store_true", help="Lista las clases de Classroom (login una sola vez)")
    group.add_argument("--class-index", type=int, help="Procesa una clase por indice (ver --list-classes)")
    group.add_argument("--continue-classroom", action="store_true", help="Procesa la siguiente clase pendiente")
    group.add_argument("--all-pending-classroom", action="store_true", help="Procesa todas las clases pendientes (max 5 por corrida)")
    group.add_argument("--only", choices=["schoolnet", "grades"], help="Procesa solo SchoolNet o solo notas/anotaciones")
    group.add_argument("--status", action="store_true", help="Muestra el estado actual sin abrir navegador")
    parser.add_argument("--max-per-run", type=int, default=5, help="Limite de clases a procesar con --all-pending-classroom")
    args = parser.parse_args()

    if args.status:
        state = load_state()
        dump = load_dump()
        print(f"Cuenta:           {dump.get('cuenta')}")
        print(f"Ultima act:       {dump.get('actualizado', 'nunca')}")
        print(f"Clases listadas:  {len(state.get('clases_lista', []))}")
        print(f"Clases procesadas:{len(state.get('clases_procesadas', []))}")
        print(f"Dump:             {CLASSROOM_DUMP}")
        for i, c in enumerate(state.get("clases_lista", [])):
            mark = "✓" if c["url"] in state.get("clases_procesadas", []) else " "
            print(f"  [{mark}] {i:2d}. {c['nombre']}")
        return

    llm = make_llm()

    if args.list_classes:
        await list_classroom_classes(llm)
    elif args.class_index is not None:
        await extract_one_class(args.class_index, llm)
    elif args.continue_classroom:
        await continue_classroom(llm, max_per_run=1)
    elif args.all_pending_classroom:
        await continue_classroom(llm, max_per_run=args.max_per_run)
    elif args.only == "schoolnet":
        await extract_schoolnet(llm)
    elif args.only == "grades":
        await extract_schoolnet_grades(llm)


if __name__ == "__main__":
    asyncio.run(main())
