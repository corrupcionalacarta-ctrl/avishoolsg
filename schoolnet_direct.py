"""
schoolnet_direct.py - Extractor directo de SchoolNet SIN browser_use/LLM.
Usa Playwright para leer JSON directamente del body de cada sección.

Las páginas /conducta, /agenda, /horario devuelven JSON crudo en el body.
/calificaciones renderiza HTML → extrae tabla vía DOM.

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
    {"index": 0, "id": "alum0", "nombre": "Clemente Aravena", "curso": "6D"},
    {"index": 1, "id": "alum1", "nombre": "Raimundo Aravena", "curso": "4A"},
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


async def select_student(page, student: dict) -> bool:
    """Clicks the parent dropdown then the student option."""
    try:
        # Open the dropdown (shows parent account name)
        opened = False
        for sel in ["div.linkAlumnos", ".selector-alumno"]:
            loc = page.locator(sel)
            if await loc.count() > 0:
                await loc.first.click()
                await page.wait_for_timeout(600)
                opened = True
                break
        if not opened:
            # Try finding by parent account name text
            loc = page.locator("a, div").filter(has_text="MANUEL ALEJANDRO").first
            if await loc.count() > 0:
                await loc.click()
                await page.wait_for_timeout(600)

        # Click the specific student option
        opt = page.locator(f"#{student['id']}")
        if await opt.count() > 0:
            await opt.click()
            await page.wait_for_timeout(2500)
            print(f"[OK] Seleccionado: {student['nombre']}")
            return True
    except Exception as e:
        print(f"[WARN] select_student({student['nombre']}): {e}")
    return False


async def extract_notas_html(page) -> list[dict]:
    """Extracts grades from the HTML table in /calificaciones via DOM."""
    return await page.evaluate("""() => {
        const notas = [];
        document.querySelectorAll('tr').forEach(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            if (cells.length < 3) return;

            const asig = cells[0]?.textContent?.trim() || '';
            if (!asig || asig.length < 2 || /^(Asignatura|ASIGNATURA)$/i.test(asig)) return;
            // Skip detail rows like "Lenguaje y comunicación. [06-D]"
            if (/\[\d{2}-[A-Z]\]/.test(asig)) return;

            // Collect valid grade values (1.0–7.0) from all cells except first
            const nums = [];
            cells.slice(1).forEach(c => {
                const t = c.textContent.trim().replace(',', '.');
                const n = parseFloat(t);
                if (!isNaN(n) && n >= 1.0 && n <= 7.0) nums.push(n);
            });
            if (nums.length === 0) return;

            // Convention: last value = GPROM (course avg), second-to-last = NF (student grade)
            const promedio_curso = nums[nums.length - 1];
            const nota = nums.length >= 2 ? nums[nums.length - 2] : null;

            notas.push({
                asignatura: asig,
                tipo: 'promedio',
                nota: nota,
                promedio_curso: promedio_curso,
                descripcion: 'Nota Final',
                fecha: null
            });
        });
        return notas;
    }""")


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
            # Search any list with "fecha" keys
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

        motivo = obs.get("motivo", "") or ""
        detalle = (obs.get("obs", "") or "").strip()
        if detalle and detalle not in ("\xa0", " ", ""):
            desc = f"{motivo} - {detalle}"
        else:
            desc = motivo

        result.append({
            "fecha": parse_fecha(obs.get("fecha")),
            "tipo": tipo,
            "descripcion": desc.strip(),
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


def parse_horario_json(data, student_index: int) -> list[dict]:
    """Parses /horario JSON body, filtering by student index (ordenalumn)."""
    if not isinstance(data, dict):
        return []
    definiciones = data.get("definiciones") or {}
    result = []
    for dia_key, dia_name in DAY_MAP.items():
        bloques = data.get(dia_key) or []
        if not isinstance(bloques, list):
            continue
        for bloque in bloques:
            if not isinstance(bloque, dict):
                continue
            orden = bloque.get("ordenalumn")
            if orden is not None and str(orden) != str(student_index):
                continue
            h_key = str(bloque.get("hora") or bloque.get("h") or "")
            h_def = definiciones.get(h_key) or {}
            if isinstance(h_def, dict):
                inicio = (h_def.get("inicio") or h_def.get("start") or
                          h_def.get("horaInicio") or "")
                fin = (h_def.get("fin") or h_def.get("end") or
                       h_def.get("horaFin") or "")
                hora_str = f"{inicio}-{fin}" if inicio else h_key
            else:
                hora_str = str(h_def) if h_def else h_key
            result.append({
                "dia": dia_name,
                "hora": hora_str,
                "asignatura": bloque.get("asignatura") or bloque.get("nombreasignatura") or "",
                "sala": bloque.get("sala") or bloque.get("room") or "",
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
        print("[INFO] Navegando a login...")
        await page.goto(login_url, wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(2000)

        need_login = "login" in page.url.lower() or await page.locator("#btn_login").count() > 0
        if need_login:
            print("[INFO] Ingresando credenciales...")
            # Try common field selectors
            for sel in ['input[name="usuario"]', 'input[type="text"]']:
                if await page.locator(sel).count() > 0:
                    await page.fill(sel, user)
                    break
            await page.fill('input[type="password"]', password)
            await page.click("#btn_login")
            await page.wait_for_timeout(4000)
            await page.wait_for_load_state("domcontentloaded", timeout=20000)
            print(f"[INFO] URL post-login: {page.url}")
        else:
            print("[INFO] Sesión ya activa")

        result = {
            "extraido_en": datetime.now().isoformat(),
            "alumnos": [],
        }

        # Fetch horario once (JSON contains all students via ordenalumn)
        horario_data_all = None

        for student in STUDENTS:
            nombre = student["nombre"]
            curso = student["curso"]
            idx = student["index"]
            print(f"\n[INFO] ===== {nombre} ({curso}) =====")

            alumno = {
                "nombre": nombre,
                "curso": curso,
                "asistencia_pct": None,
                "notas": [],
                "anotaciones": [],
                "agenda": [],
                "horario": [],
            }

            # --- CALIFICACIONES (HTML table) ---
            try:
                print(f"[INFO] Calificaciones...")
                await page.goto(f"{BASE_URL}/calificaciones", wait_until="domcontentloaded")
                await page.wait_for_timeout(2000)
                await select_student(page, student)
                notas = await extract_notas_html(page)
                alumno["notas"] = notas
                print(f"[OK] Notas: {len(notas)}")
            except Exception as e:
                print(f"[WARN] Calificaciones: {e}")

            # --- CONDUCTA (JSON body, session carries student selection) ---
            try:
                print(f"[INFO] Conducta...")
                await page.goto(f"{BASE_URL}/conducta", wait_until="domcontentloaded")
                await page.wait_for_timeout(3000)
                data = await wait_for_json_body(page, timeout_ms=8000)
                if data:
                    anotaciones = parse_conducta_json(data)
                    alumno["anotaciones"] = anotaciones
                    print(f"[OK] Anotaciones: {len(anotaciones)}")
                else:
                    print("[WARN] Conducta: sin JSON en body")
            except Exception as e:
                print(f"[WARN] Conducta: {e}")

            # --- AGENDA (JSON body with ordenalumn filter) ---
            try:
                print(f"[INFO] Agenda...")
                await page.goto(f"{BASE_URL}/agenda", wait_until="domcontentloaded")
                await page.wait_for_timeout(3000)
                data = await wait_for_json_body(page, timeout_ms=8000)
                if data:
                    agenda = parse_agenda_json(data, idx)
                    alumno["agenda"] = agenda
                    print(f"[OK] Agenda: {len(agenda)}")
                else:
                    print("[WARN] Agenda: sin JSON en body")
            except Exception as e:
                print(f"[WARN] Agenda: {e}")

            # --- HORARIO (JSON body, fetch once, filter per student) ---
            try:
                if horario_data_all is None:
                    print(f"[INFO] Horario (fetching once)...")
                    await page.goto(f"{BASE_URL}/horario", wait_until="domcontentloaded")
                    await page.wait_for_timeout(3000)
                    horario_data_all = await wait_for_json_body(page, timeout_ms=8000)

                if horario_data_all:
                    horario = parse_horario_json(horario_data_all, idx)
                    alumno["horario"] = horario
                    print(f"[OK] Horario: {len(horario)} bloques")
                else:
                    print("[WARN] Horario: sin JSON en body")
            except Exception as e:
                print(f"[WARN] Horario: {e}")

            result["alumnos"].append(alumno)

            # Switch student for next iteration: go back to calificaciones and switch
            # (session carries student selection to conducta/agenda)
            if idx < len(STUDENTS) - 1:
                next_student = STUDENTS[idx + 1]
                try:
                    await page.goto(f"{BASE_URL}/calificaciones", wait_until="domcontentloaded")
                    await page.wait_for_timeout(2000)
                    await select_student(page, next_student)
                except Exception:
                    pass

        await ctx.close()

    # Save JSON file
    out_file = OUTPUT_DIR / f"schoolnet_grades_{datetime.now().strftime('%Y%m%d')}.json"
    out_file.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n[OK] Guardado: {out_file}")
    for a in result["alumnos"]:
        print(f"     {a['nombre']}: notas={len(a.get('notas',[]))} "
              f"anotaciones={len(a.get('anotaciones',[]))} "
              f"agenda={len(a.get('agenda',[]))} "
              f"horario={len(a.get('horario',[]))}")

    # Push to Supabase
    try:
        from supabase_push import push_grades
        push_grades(result)
    except Exception as e:
        print(f"[WARN] Supabase push: {e}")


if __name__ == "__main__":
    asyncio.run(main())
