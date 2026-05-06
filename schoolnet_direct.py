"""
schoolnet_direct.py - Extractor directo de SchoolNet SIN browser_use/LLM.
Usa Playwright para leer JSON directamente del body de cada sección.

Todas las páginas (/calificaciones, /conducta, /agenda, /horario) devuelven
JSON crudo en el body — no hay HTML que parsear.

Estructura JSON real (descubierta 2026-05-04):
  /calificaciones → dict columnar: {nombre: [], nf: [], gprom: [], esmadre: [], ...}
  /conducta       → array de anotaciones o {encConducta: {anotaciones: []}}
  /agenda         → {eventAgenda: [...]} con campo ordenalumn para filtrar por alumno
  /horario        → {dia_1: {h1: [...], h2: [...]}, definiciones: ["Bloque 1 | HH:MM-HH:MM", ...]}

Student switching: el servidor es session-based. Después del login la sesión
apunta al primer alumno (alumno=0). Para cambiar al segundo se navega a /index
(Angular UI) y se hace click en el tab del alumno por nombre.

Uso:
    python schoolnet_direct.py
"""
import asyncio
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_URL = "https://schoolnet.colegium.com/webapp/es_CL"
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "."))
BROWSER_DATA_DIR = OUTPUT_DIR / ".browser_session"
HEADLESS = os.getenv("HEADLESS", "false").lower() == "true"

STUDENTS = [
    {"index": 0, "id": "alum0", "nombre": "Clemente Aravena", "nombre_corto": "CLEMENTE", "curso": "6D"},
    {"index": 1, "id": "alum1", "nombre": "Raimundo Aravena", "nombre_corto": "RAIMUNDO", "curso": "4A"},
]

DAY_MAP = {
    "dia_1": "lunes", "dia_2": "martes", "dia_3": "miercoles",
    "dia_4": "jueves", "dia_5": "viernes",
}


def parse_fecha(s) -> str | None:
    if not s:
        return None
    s = str(s).strip()
    m = re.match(r'^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$', s)
    if m:
        d, mo, y = m.groups()
        if len(y) == 2:
            y = "20" + y
        return f"{y}-{mo.zfill(2)}-{d.zfill(2)}"
    if re.match(r'^\d{4}-\d{2}-\d{2}$', s):
        return s
    return None


async def wait_for_json_body(page, timeout_ms: int = 10000) -> dict | list | None:
    """Polls document.body.innerText until it contains valid JSON."""
    loop = asyncio.get_event_loop()
    deadline = loop.time() + timeout_ms / 1000
    while loop.time() < deadline:
        try:
            text = await page.evaluate("() => document.body.innerText")
            if text:
                text = text.strip()
                if text.startswith('{') or text.startswith('['):
                    return json.loads(text)
        except Exception:
            pass
        await asyncio.sleep(0.5)
    return None


async def api_fetch(page, path: str) -> dict | list | None:
    """
    Calls a SchoolNet JSON API endpoint using fetch() from within the Angular page context.
    This is required because with a valid session the server returns Angular HTML for direct
    browser navigation, but returns JSON for AJAX (XHR) requests — same as the Angular app.
    """
    url = f"{BASE_URL}/{path.lstrip('/')}"
    try:
        result = await page.evaluate(f"""async () => {{
            const r = await fetch('{url}', {{
                method: 'GET',
                headers: {{
                    'Accept': 'application/json, text/plain, */*',
                    'X-Requested-With': 'XMLHttpRequest'
                }},
                credentials: 'same-origin'
            }});
            if (!r.ok) return null;
            const text = await r.text();
            try {{ return JSON.parse(text); }} catch(e) {{ return null; }}
        }}""")
        return result
    except Exception as e:
        print(f"[WARN] api_fetch({path}): {e}")
        return None


async def switch_student(page, student: dict) -> bool:
    """
    Switches active student in SchoolNet session.

    Strategy order:
    1. SubCookieUtil.seteaCookie('rel', idx) — jQuery subcookie used by the app
    2. document.cookie direct set — fallback if SubCookieUtil not available
    3. Click #linkcalificaciones → click #alumN tab — UI-driven switch
    4. Playwright context cookie override + /index reload — nuclear option

    Each strategy verifies via api_fetch /calificaciones checking alumno == idx.
    """
    idx = student["index"]
    student_id = student["id"]  # "alum0" or "alum1"
    nombre_corto = student["nombre_corto"]
    print(f"[INFO] Switching a {nombre_corto} (idx={idx})...")

    async def _verify() -> bool:
        data = await api_fetch(page, "/calificaciones")
        if data and isinstance(data, dict) and str(data.get("alumno")) == str(idx):
            print(f"[OK] Switch verificado: alumno={data.get('alumno')}")
            return True
        return False

    # Strategy 1: SubCookieUtil (jQuery subcookie mechanism)
    try:
        await page.evaluate(f"SubCookieUtil.seteaCookie('rel', '{idx}')")
        await page.wait_for_timeout(800)
        if await _verify():
            return True
        print(f"[WARN] SubCookieUtil: cookie seteada pero alumno no cambió")
    except Exception as e:
        print(f"[WARN] SubCookieUtil no disponible: {e}")

    # Strategy 2: document.cookie direct (works if server reads 'rel' cookie directly)
    try:
        await page.evaluate(f"document.cookie = 'rel={idx}; path=/'")
        await page.wait_for_timeout(800)
        if await _verify():
            return True
        print(f"[WARN] document.cookie: cookie seteada pero alumno no cambió")
    except Exception as e:
        print(f"[WARN] document.cookie: {e}")

    # Strategy 3: Click nav → student tab in the rendered UI
    try:
        nav = page.locator("#linkcalificaciones")
        if await nav.count() > 0:
            await nav.click()
            await page.wait_for_timeout(3000)
            # Try #alumN tab first
            tab = page.locator(f"#{student_id}")
            if await tab.count() > 0 and await tab.is_visible():
                await tab.click()
                await page.wait_for_timeout(2000)
                if await _verify():
                    return True
            # Fallback: click by visible text
            tab2 = page.locator(f"a:text-is('{nombre_corto}'), span:text-is('{nombre_corto}')").first
            if await tab2.count() > 0:
                await tab2.click()
                await page.wait_for_timeout(2000)
                if await _verify():
                    return True
    except Exception as e:
        print(f"[WARN] UI click strategy: {e}")

    # Strategy 4: Playwright-level cookie override + /index reload
    try:
        await page.context.add_cookies([{
            "name": "rel",
            "value": str(idx),
            "domain": "schoolnet.colegium.com",
            "path": "/",
        }])
        await page.goto(f"{BASE_URL}/index", wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(3000)
        if await _verify():
            return True
        print(f"[WARN] Cookie override + reload: alumno no cambió")
    except Exception as e:
        print(f"[WARN] Cookie override strategy: {e}")

    print(f"[ERROR] No se pudo hacer switch a {nombre_corto} — se omiten sus datos")
    return False


def parse_calificaciones_json(data: dict) -> list[dict]:
    """
    Parses the columnar JSON from /calificaciones.
    All fields are parallel arrays indexed by subject row.

    SchoolNet returns each subject twice:
      - Clean name: "Lenguaje y comunicación" (may be esmadre=0 or =1)
      - Suffixed dup: "Lenguaje y comunicación. [06-D]" or "Asig g2 [06-ABCDE]"
    We skip the suffixed duplicates and keep the clean name row.
    esmadre is NOT used as a filter — any row with a nota final is valid.
    """
    nombres = data.get("nombre", [])
    nf = data.get("nf", [])
    gprom = data.get("gprom", [])

    def _parse_nota(s) -> float | None:
        if not s or s in ("", "&nbsp;"):
            return None
        try:
            return float(str(s).replace(",", "."))
        except (ValueError, TypeError):
            return None

    # Regex: matches group-suffix at end like " [06-D]", ". [06-D]", " g2 [06-ABCDE]"
    _suffix_re = re.compile(r'\.?\s*(g\d+\s*)?\[[\dA-Z-]+\]\s*$')

    result = []
    seen: set[str] = set()

    for i, nombre in enumerate(nombres):
        if not nombre or len(nombre) < 2:
            continue
        # Skip the suffixed duplicate rows
        if _suffix_re.search(nombre):
            continue

        nota = _parse_nota(nf[i] if i < len(nf) else "")
        prom = _parse_nota(gprom[i] if i < len(gprom) else "")

        if nota is None and prom is None:
            continue

        key = nombre.strip().lower()
        if key in seen:
            continue
        seen.add(key)

        result.append({
            "asignatura": nombre.strip(),
            "tipo": "promedio",
            "nota": nota,
            "promedio_curso": prom,
            "descripcion": "Nota Final",
            "fecha": None,
        })

    return result


def parse_conducta_json(data) -> list[dict]:
    """Parses /conducta JSON body (array or nested object) into anotaciones."""
    obs_list = None
    if isinstance(data, list):
        obs_list = data
    elif isinstance(data, dict):
        for key in ["encConducta", "conducta", "anotaciones", "data"]:
            val = data.get(key)
            if isinstance(val, list):
                obs_list = val
                break
            if isinstance(val, dict):
                for k2 in ["anotaciones", "conducta", "data", "items"]:
                    if isinstance(val.get(k2), list):
                        obs_list = val[k2]
                        break
            if obs_list:
                break
        if not obs_list:
            for val in data.values():
                if isinstance(val, list) and val and isinstance(val[0], dict) and "fecha" in val[0]:
                    obs_list = val
                    break

    if not obs_list:
        return []

    result = []
    for obs in obs_list:
        if not isinstance(obs, dict):
            continue
        categoria = obs.get("categoria", "")
        if "Positiva" in categoria:
            tipo = "positiva"
        elif "Negativa" in categoria:
            tipo = "negativa"
        else:
            tipo = "observacion"

        motivo = (obs.get("motivo", "") or "").strip()
        # Strip (*) prefix used internally by SchoolNet
        motivo = re.sub(r'^\(\*\)\s*', '', motivo).strip()

        detalle = (obs.get("obs", "") or "").strip()
        # Treat &nbsp; (literal or decoded \xa0) as empty
        if detalle in ("&nbsp;", "\xa0", " ", ""):
            desc = ""
        else:
            desc = detalle

        result.append({
            "fecha": parse_fecha(obs.get("fecha")),
            "tipo": tipo,
            "titulo": motivo,
            "descripcion": desc,
            "asignatura": obs.get("nombreasignatura") or "",
        })
    return result


def parse_agenda_json(data, student_index: int) -> list[dict]:
    """Parses /agenda JSON body, filtering by student index (ordenalumn)."""
    if not isinstance(data, dict):
        return []
    events = (data.get("eventAgenda") or data.get("agenda") or
              data.get("items") or data.get("eventos") or [])
    result = []
    for ev in events:
        if not isinstance(ev, dict):
            continue
        orden = ev.get("ordenalumn")
        if orden is not None and str(orden) != str(student_index):
            continue
        fecha_raw = ev.get("fecha") or ev.get("date") or ev.get("fechaEvento") or ""
        desc = (ev.get("titulo") or ev.get("title") or
                ev.get("descripcion") or ev.get("nombre") or "")
        asig = ev.get("asignatura") or ev.get("nombreasignatura") or ""
        result.append({
            "fecha": parse_fecha(fecha_raw),
            "descripcion": str(desc),
            "asignatura": str(asig),
        })
    return result


def parse_asistencia_json(data, student_index: int = 0) -> dict:
    """
    Extracts student photo and teacher info from /asistencia JSON.
    The endpoint returns: fotosAlumnos (base64 JPEGs), nombProfJefe, modasist, etc.
    """
    if not data or not isinstance(data, dict):
        return {}

    result = {}

    # Extract student photo (base64 JPEG indexed by student position)
    fotos = data.get("fotosAlumnos") or []
    if isinstance(fotos, list) and student_index < len(fotos):
        foto_b64 = fotos[student_index]
        if foto_b64 and isinstance(foto_b64, str) and len(foto_b64) > 100:
            result["foto_b64"] = foto_b64

    # Teacher name
    prof = data.get("nombProfJefe") or []
    if isinstance(prof, list) and prof:
        result["prof_jefe"] = prof[0]
    elif isinstance(prof, str):
        result["prof_jefe"] = prof

    # modasist / modatras (attendance mode indicators — not percentages)
    result["modasist"] = data.get("modasist")

    return result


def parse_horario_json(data: dict, student_index: int) -> list[dict]:
    """
    Parses /horario JSON body.
    dia_X is a DICT {h1: [...], h2: [...]} — NOT a list.
    definiciones is a LIST ["Bloque 1 | 08:00-08:10", "Bloque 2 | ..."].
    h-key number (1-based) maps to definiciones index (0-based).
    The JSON already reflects the selected student (session-based).
    """
    if not isinstance(data, dict):
        return []
    definiciones = data.get("definiciones") or []  # list of strings

    result = []
    for dia_key, dia_name in DAY_MAP.items():
        dia_data = data.get(dia_key)
        if not isinstance(dia_data, dict):
            continue

        for h_key, bloque_list in dia_data.items():
            # h_key = "h1", "h2", "h10" etc. → 1-based index into definiciones
            try:
                h_num = int(h_key.lstrip("h")) - 1  # h1 → index 0
                if isinstance(definiciones, list) and 0 <= h_num < len(definiciones):
                    hora_str = str(definiciones[h_num])
                else:
                    hora_str = h_key
            except (ValueError, IndexError):
                hora_str = h_key

            if not isinstance(bloque_list, list):
                bloque_list = [bloque_list] if bloque_list else []

            for bloque in bloque_list:
                if not isinstance(bloque, dict):
                    continue
                result.append({
                    "dia": dia_name,
                    "hora": hora_str,
                    "asignatura": bloque.get("asig") or bloque.get("asignatura") or "",
                    "sala": bloque.get("sala") or "",
                })

    return result


async def main():
    from playwright.async_api import async_playwright

    login_url = os.getenv("SCHOOLNET_URL")
    user = os.getenv("SCHOOLNET_USER")
    password = os.getenv("SCHOOLNET_PASS")

    if not all([login_url, user, password]):
        print("[ERROR] Faltan SCHOOLNET_URL, SCHOOLNET_USER o SCHOOLNET_PASS en .env")
        sys.exit(1)

    print("[INFO] Iniciando extractor directo SchoolNet (sin LLM)...")

    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            user_data_dir=str(BROWSER_DATA_DIR),
            headless=HEADLESS,
            args=["--no-sandbox"],
            timeout=60000,
        )
        page = await ctx.new_page()
        page.set_default_timeout(30000)

        # === LOGIN ===
        # Navigate to a protected JSON endpoint first — if session active we get JSON,
        # if not the server redirects to login.
        print("[INFO] Verificando sesión...")
        await page.goto(f"{BASE_URL}/calificaciones", wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(2000)

        need_login = "login" in page.url.lower() or await page.locator("#btn_login").count() > 0
        if need_login:
            print("[INFO] Sesión expirada, ingresando credenciales...")
            if login_url:
                await page.goto(login_url, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_timeout(1500)
            # Try specific name selectors first, then first visible text input
            # Fill username: try specific selectors then any visible text input
            filled = False
            for sel in ['input[name="usuario"]', 'input[name="rut"]', 'input[name="username"]',
                        'input[id="rut"]', 'input[id="usuario"]']:
                loc = page.locator(sel)
                try:
                    if await loc.count() > 0 and await loc.first.is_visible():
                        await loc.first.fill(user)
                        filled = True
                        print(f"[INFO] Usuario llenado via {sel}")
                        break
                except Exception:
                    continue
            if not filled:
                # Fallback: all visible text inputs, skip hidden ones
                inputs = page.locator('input[type="text"]')
                cnt = await inputs.count()
                for i in range(cnt):
                    inp = inputs.nth(i)
                    try:
                        if await inp.is_visible():
                            await inp.fill(user)
                            filled = True
                            print(f"[INFO] Usuario llenado via text input #{i}")
                            break
                    except Exception:
                        continue
            if not filled:
                print("[WARN] No se encontró campo de usuario visible — intentando igual")

            # Fill password
            pw_loc = page.locator('input[type="password"]:visible')
            if await pw_loc.count() > 0:
                await pw_loc.first.fill(password)
            else:
                await page.locator('input[type="password"]').first.fill(password)

            # Click login button — use JS click as fallback if Playwright times out
            try:
                await page.locator("#btn_login").click(timeout=15000)
            except Exception:
                print("[INFO] Click normal falló, usando JS click...")
                try:
                    await page.evaluate("document.getElementById('btn_login').click()")
                except Exception:
                    pass  # Context destroyed = navigation happened = login OK
            await page.wait_for_timeout(4000)
            await page.wait_for_load_state("domcontentloaded", timeout=20000)
            print(f"[INFO] URL post-login: {page.url}")
        else:
            print("[INFO] Sesión ya activa")

        # Stay on /index so Angular context is active for api_fetch()
        await page.goto(f"{BASE_URL}/index", wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(3000)
        print(f"[INFO] Angular cargado en: {page.url}")


        result = {
            "extraido_en": datetime.now().isoformat(),
            "alumnos": [],
        }

        for student in STUDENTS:
            nombre = student["nombre"]
            curso = student["curso"]
            idx = student["index"]
            print(f"\n[INFO] ===== {nombre} ({curso}) =====")

            alumno = {
                "nombre": nombre,
                "curso": curso,
                "asistencia_pct": None,
                "inasistencias": None,
                "horas_efectuadas": None,
                "foto_b64": None,
                "prof_jefe": None,
                "notas": [],
                "anotaciones": [],
                "agenda": [],
                "horario": [],
            }

            # Switch to correct student — skip all data fetching if switch fails
            switched = await switch_student(page, student)
            if not switched:
                print(f"[ERROR] Skip {nombre} — datos incorrectos si se continúa")
                result["alumnos"].append(alumno)
                continue

            # --- CALIFICACIONES (AJAX via api_fetch) ---
            try:
                print(f"[INFO] Calificaciones...")
                data = await api_fetch(page, "/calificaciones")
                if data and isinstance(data, dict):
                    alumno_actual = data.get("alumno")
                    if str(alumno_actual) != str(idx):
                        print(f"[WARN] alumno={alumno_actual}, esperado={idx} — datos pueden ser del alumno anterior")
                    notas = parse_calificaciones_json(data)
                    alumno["notas"] = notas
                    print(f"[OK] Notas: {len(notas)}")
                else:
                    print("[WARN] Calificaciones: sin datos")
            except Exception as e:
                print(f"[WARN] Calificaciones: {e}")

            # --- CONDUCTA ---
            try:
                print(f"[INFO] Conducta...")
                data = await api_fetch(page, "/conducta")
                if data:
                    anotaciones = parse_conducta_json(data)
                    alumno["anotaciones"] = anotaciones
                    print(f"[OK] Anotaciones: {len(anotaciones)}")
                else:
                    print("[WARN] Conducta: sin datos")
            except Exception as e:
                print(f"[WARN] Conducta: {e}")

            # --- AGENDA ---
            try:
                print(f"[INFO] Agenda...")
                data = await api_fetch(page, "/agenda")
                if data:
                    agenda = parse_agenda_json(data, idx)
                    alumno["agenda"] = agenda
                    print(f"[OK] Agenda: {len(agenda)}")
                else:
                    print("[WARN] Agenda: sin datos")
            except Exception as e:
                print(f"[WARN] Agenda: {e}")

            # --- ASISTENCIA / FOTOS ---
            try:
                print(f"[INFO] Asistencia/Fotos...")
                data = await api_fetch(page, "/asistencia")
                if data:
                    asist = parse_asistencia_json(data, idx)
                    if asist.get("foto_b64"):
                        alumno["foto_b64"] = asist["foto_b64"]
                        print(f"[OK] Foto extraída ({len(asist['foto_b64'])} chars b64)")
                    if asist.get("prof_jefe"):
                        alumno["prof_jefe"] = asist["prof_jefe"]
                        print(f"[OK] Prof. Jefe: {asist['prof_jefe']}")
                else:
                    print("[WARN] Asistencia: sin datos")
            except Exception as e:
                print(f"[WARN] Asistencia: {e}")

            # --- HORARIO ---
            try:
                print(f"[INFO] Horario...")
                data = await api_fetch(page, "/horario")
                if data and isinstance(data, dict):
                    horario = parse_horario_json(data, idx)
                    alumno["horario"] = horario
                    print(f"[OK] Horario: {len(horario)} bloques")
                else:
                    print("[WARN] Horario: sin datos")
            except Exception as e:
                print(f"[WARN] Horario: {e}")

            result["alumnos"].append(alumno)

        await ctx.close()

    # Save JSON file
    out_file = OUTPUT_DIR / f"schoolnet_grades_{datetime.now().strftime('%Y%m%d')}.json"
    out_file.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n[OK] Guardado: {out_file}")
    for a in result["alumnos"]:
        print(f"     {a['nombre']}: notas={len(a.get('notas', []))} "
              f"anotaciones={len(a.get('anotaciones', []))} "
              f"agenda={len(a.get('agenda', []))} "
              f"horario={len(a.get('horario', []))}")

    # Push to Supabase
    try:
        from supabase_push import push_grades
        push_grades(result)
    except Exception as e:
        print(f"[WARN] Supabase push: {e}")


if __name__ == "__main__":
    asyncio.run(main())
