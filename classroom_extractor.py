"""
classroom_extractor.py - Extractor de Google Classroom vía Playwright.
======================================================================
Usa sesión persistente del navegador: login manual la primera vez,
luego corre en modo headless con las cookies guardadas.

Extrae por alumno:
  - Cursos activos
  - Tareas (título, fecha entrega, estado, calificación)
  - Anuncios recientes (últimos 7 días)

Persiste en tabla Supabase `classroom` (ver create_tables.sql).

Uso:
    python classroom_extractor.py              # todos los alumnos configurados
    python classroom_extractor.py clemente     # solo Clemente
    python classroom_extractor.py raimundo     # solo Raimundo
    python classroom_extractor.py --login      # forzar login manual (no headless)
"""

import asyncio
import json
import os
import re
import sys
from datetime import datetime, date, timedelta
from pathlib import Path

from dotenv import load_dotenv
from playwright.async_api import async_playwright, Page, BrowserContext

load_dotenv()

OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "."))
HEADLESS = os.getenv("HEADLESS", "false").lower() == "true"

# Sesiones separadas por alumno para no mezclar cookies Google
CLASSROOM_URL = "https://classroom.google.com"


def _clean(k, default=""):
    return (os.getenv(k) or default).strip()


ALUMNOS_CONFIG = []
for i in (1, 2):
    nombre = _clean(f"ALUMNO_{i}_NOMBRE")
    email  = _clean(f"ALUMNO_{i}_CLASSROOM")
    if nombre and email:
        ALUMNOS_CONFIG.append({
            "nombre": nombre,
            "email": email,
            "slug": nombre.split()[0].lower(),
            "session_dir": OUTPUT_DIR / f".browser_classroom_{nombre.split()[0].lower()}",
        })


# ─────────────────────────────────────────────────────────────────────────────
# Playwright helpers
# ─────────────────────────────────────────────────────────────────────────────

async def get_context(playwright, alumno: dict, force_visible: bool = False) -> BrowserContext:
    """Devuelve contexto con sesión persistente para el alumno."""
    session_dir = alumno["session_dir"]
    session_dir.mkdir(parents=True, exist_ok=True)

    headless = HEADLESS and not force_visible
    ctx = await playwright.chromium.launch_persistent_context(
        str(session_dir),
        headless=headless,
        args=["--disable-blink-features=AutomationControlled"],
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        viewport={"width": 1280, "height": 900},
        locale="es-CL",
    )
    return ctx


async def ensure_logged_in(page: Page, alumno: dict) -> bool:
    """
    Verifica que la sesión esté activa.
    Devuelve True si OK, False si se necesita login manual.
    """
    await page.goto(CLASSROOM_URL, wait_until="domcontentloaded", timeout=30000)
    await asyncio.sleep(3)

    url = page.url
    # Si redirigió a accounts.google.com → no hay sesión
    if "accounts.google.com" in url or "signin" in url.lower():
        print(f"[WARN] {alumno['nombre']}: no hay sesión guardada — se necesita login manual")
        print(f"       Corre:  python classroom_extractor.py --login")
        return False

    # Verificar que estamos en Classroom
    if "classroom.google.com" in url:
        print(f"[OK] {alumno['nombre']}: sesión activa en Classroom")
        return True

    print(f"[WARN] URL inesperada: {url}")
    return False


async def login_manual(page: Page, alumno: dict):
    """Login manual a Google (para primera vez o sesión expirada)."""
    email = alumno["email"]
    print(f"\n[LOGIN] Iniciando login para {alumno['nombre']} ({email})")
    print("        El navegador se abrirá — completa el login y presiona Enter aquí.")

    await page.goto("https://accounts.google.com/signin", wait_until="domcontentloaded")

    # Intentar completar email automáticamente
    try:
        email_input = page.locator('input[type="email"]')
        await email_input.wait_for(timeout=5000)
        await email_input.fill(email)
        await page.keyboard.press("Enter")
        await asyncio.sleep(2)
    except Exception:
        pass  # Usuario lo completa manual

    input(f"\n  Completa el login de {email} en el navegador y luego presiona Enter aquí... ")

    await page.goto(CLASSROOM_URL, wait_until="domcontentloaded")
    await asyncio.sleep(3)

    if "classroom.google.com" in page.url:
        print(f"[OK] Login exitoso para {alumno['nombre']}")
        return True

    print(f"[ERROR] No se pudo confirmar login. URL actual: {page.url}")
    return False


# ─────────────────────────────────────────────────────────────────────────────
# Scraping de Google Classroom
# ─────────────────────────────────────────────────────────────────────────────

async def get_courses(page: Page) -> list[dict]:
    """
    Extrae la lista de cursos de la página principal de Classroom.
    Retorna: [{id, nombre, enlace}]
    """
    await page.goto(CLASSROOM_URL, wait_until="domcontentloaded", timeout=30000)
    await asyncio.sleep(4)

    # Esperar que carguen los cursos
    try:
        await page.wait_for_selector("a[href*='/c/']", timeout=15000)
    except Exception:
        print("[WARN] Timeout esperando cursos — puede que no haya cursos o no hay sesión")
        return []

    courses = await page.evaluate("""() => {
        const seen = new Set();
        const result = [];

        // Buscar todos los links que llevan a un curso específico (/c/ID sin más paths)
        const links = [...document.querySelectorAll('a[href]')];
        for (const a of links) {
            const href = a.getAttribute('href') || '';
            const fullHref = a.href || '';

            // Match: /c/COURSE_ID (puede tener query params pero no más paths)
            const m = fullHref.match(/classroom\\.google\\.com\\/c\\/([A-Za-z0-9_-]+)(?:[?#].*)?$/);
            if (!m) continue;

            const courseId = m[1];
            if (seen.has(courseId)) continue;
            seen.add(courseId);

            // Buscar el nombre del curso en el contenedor del card
            const card = a.closest('[role="listitem"], li, article, [class*="card"], [class*="Card"]') || a;
            let name = '';

            // Prioridad: aria-label del link
            name = a.getAttribute('aria-label') || '';
            if (!name) {
                // Buscar heading dentro del card
                const h = card.querySelector('h2, h3, h1, [class*="Title"], [class*="title"], [class*="name"]');
                name = h ? h.textContent.trim() : '';
            }
            if (!name) {
                name = a.textContent.trim();
            }

            // Limpiar nombre: quitar "ir a" prefijos
            name = name.replace(/^(ir a |go to )/i, '').trim();

            if (!name || name.length < 2) continue;

            result.push({
                id: courseId,
                nombre: name,
                enlace: 'https://classroom.google.com/c/' + courseId,
            });
        }

        return result;
    }""")

    # Filtrar nombres que parezcan cursos (no UI elements)
    courses = [c for c in courses if len(c["nombre"]) > 2 and not c["nombre"].lower().startswith("menu")]
    print(f"[OK] {len(courses)} cursos encontrados")
    for c in courses:
        print(f"     - {c['nombre']} ({c['id']})")
    return courses


async def get_course_assignments(page: Page, course: dict) -> list[dict]:
    """
    Navega al tab 'Trabajo de clase' del curso y extrae todas las tareas.
    Retorna lista de dicts con: titulo, tipo, fecha_entrega, estado, calificacion, link
    """
    classwork_url = f"https://classroom.google.com/c/{course['id']}/t/all"
    await page.goto(classwork_url, wait_until="domcontentloaded", timeout=30000)
    await asyncio.sleep(4)

    # Esperar que carguen las tareas
    try:
        await page.wait_for_selector(
            "li[class], [role='listitem'], .pHZ6Fd, .kpGEdb",
            timeout=10000
        )
    except Exception:
        # Intentar igual
        await asyncio.sleep(2)

    assignments = await page.evaluate("""() => {
        const result = [];
        const seen = new Set();

        // Google Classroom assignments en el tab de Trabajo de clase
        // Buscar todos los items que tengan link a una tarea /a/ o /p/ (pregunta)
        const taskLinks = [...document.querySelectorAll('a[href*="/c/"][href*="/a/"], a[href*="/c/"][href*="/p/"]')];

        for (const link of taskLinks) {
            const href = link.href || '';
            if (seen.has(href)) continue;
            seen.add(href);

            // Extraer tipo de la URL
            const tipo = href.includes('/a/') ? 'tarea' :
                        href.includes('/p/') ? 'pregunta' : 'tarea';

            // El contenedor del item
            const item = link.closest('li, [role="listitem"], [jscontroller]') || link.parentElement;

            // Título: texto del link o heading dentro del item
            let titulo = link.getAttribute('aria-label') || '';
            if (!titulo) {
                const h = item ? item.querySelector('p, span, h3, h4, [class*="title"]') : null;
                titulo = h ? h.textContent.trim() : link.textContent.trim();
            }
            titulo = titulo.replace(/\\s+/g, ' ').trim();
            if (!titulo || titulo.length < 2) continue;

            // Fecha de entrega: buscar texto con patrón de fecha
            let fechaTexto = '';
            if (item) {
                const allText = [...item.querySelectorAll('span, p, div')].map(e => e.textContent.trim());
                for (const t of allText) {
                    // Patrones comunes: "Fecha de entrega: X", "Vence el...", "entrega hoy", fechas
                    if (/\\d+.*\\d+|hoy|mañana|vence/i.test(t) && t.length < 80) {
                        fechaTexto = t;
                        break;
                    }
                }
            }

            // Estado: buscar texto de estado
            let estado = 'pendiente';
            if (item) {
                const itemText = item.textContent.toLowerCase();
                if (itemText.includes('entregado') || itemText.includes('turned in') || itemText.includes('submitted')) {
                    estado = 'entregado';
                } else if (itemText.includes('calificado') || itemText.includes('graded')) {
                    estado = 'calificado';
                } else if (itemText.includes('devuelto') || itemText.includes('returned')) {
                    estado = 'devuelto';
                } else if (itemText.includes('atrasado') || itemText.includes('late') || itemText.includes('vencido')) {
                    estado = 'atrasado';
                }
            }

            // Calificación: buscar texto tipo "7/7" o "85/100"
            let calificacion = null;
            if (item) {
                const gradePat = item.textContent.match(/(\\d+(?:[,.]\\d+)?)\\s*\\/\\s*(\\d+)/);
                if (gradePat) {
                    calificacion = gradePat[0];
                }
            }

            result.push({
                titulo,
                tipo,
                fecha_texto: fechaTexto,
                estado,
                calificacion,
                link: href,
            });
        }

        return result;
    }""")

    print(f"     [{course['nombre']}] {len(assignments)} tareas")
    return assignments


async def get_course_announcements(page: Page, course: dict) -> list[dict]:
    """
    Extrae anuncios del stream del curso (últimos 7 días).
    """
    stream_url = f"https://classroom.google.com/c/{course['id']}"
    await page.goto(stream_url, wait_until="domcontentloaded", timeout=30000)
    await asyncio.sleep(3)

    announcements = await page.evaluate("""() => {
        const result = [];
        // Anuncios en el stream: posts que no son tareas
        const posts = document.querySelectorAll('[jscontroller][data-announcementid], [class*="announcement"]');

        for (const post of posts) {
            const text = post.textContent.trim().substring(0, 200);
            if (!text || text.length < 10) continue;

            // Buscar fecha del post
            let fechaTexto = '';
            const timeEl = post.querySelector('time, [class*="time"], [class*="date"]');
            if (timeEl) {
                fechaTexto = timeEl.getAttribute('datetime') || timeEl.textContent.trim();
            }

            result.push({
                titulo: text.substring(0, 100),
                tipo: 'anuncio',
                fecha_texto: fechaTexto,
                estado: 'informativo',
                link: window.location.href,
            });
        }

        return result.slice(0, 5);  // max 5 anuncios por curso
    }""")

    return announcements


# ─────────────────────────────────────────────────────────────────────────────
# Parseo de fechas en español
# ─────────────────────────────────────────────────────────────────────────────

MESES_ES = {
    'ene': 1, 'enero': 1, 'feb': 2, 'febrero': 2, 'mar': 3, 'marzo': 3,
    'abr': 4, 'abril': 4, 'may': 5, 'mayo': 5, 'jun': 6, 'junio': 6,
    'jul': 7, 'julio': 7, 'ago': 8, 'agosto': 8, 'sep': 9, 'septiembre': 9,
    'oct': 10, 'octubre': 10, 'nov': 11, 'noviembre': 11, 'dic': 12, 'diciembre': 12,
}


def parse_fecha_classroom(texto: str) -> str | None:
    """
    Parsea textos de fecha de Google Classroom en español:
    "hoy", "mañana", "7 may.", "7 de mayo", "7/5", "2025-05-07"
    Retorna YYYY-MM-DD o None.
    """
    if not texto:
        return None
    texto = texto.strip().lower()
    hoy = date.today()

    if 'hoy' in texto:
        return hoy.isoformat()
    if 'mañana' in texto or 'mañana' in texto:
        return (hoy + timedelta(days=1)).isoformat()

    # ISO format
    m = re.search(r'(\d{4})-(\d{2})-(\d{2})', texto)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"

    # "7 may." o "7 de mayo"
    m = re.search(r'(\d{1,2})\s+(?:de\s+)?([a-záéíóú]+)\.?(?:\s+(\d{4}))?', texto)
    if m:
        dia = int(m.group(1))
        mes_str = m.group(2)[:3]
        year = int(m.group(3)) if m.group(3) else hoy.year
        mes = MESES_ES.get(mes_str)
        if mes:
            # Si la fecha ya pasó y no hay año explícito, puede ser año siguiente
            d = date(year, mes, dia)
            if not m.group(3) and d < hoy - timedelta(days=30):
                d = date(year + 1, mes, dia)
            return d.isoformat()

    # "DD/MM" o "DD/MM/YYYY"
    m = re.search(r'(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?', texto)
    if m:
        dia, mes = int(m.group(1)), int(m.group(2))
        year = int(m.group(3)) if m.group(3) else hoy.year
        if len(str(year)) == 2:
            year += 2000
        try:
            return date(year, mes, dia).isoformat()
        except ValueError:
            pass

    return None


# ─────────────────────────────────────────────────────────────────────────────
# Supabase push
# ─────────────────────────────────────────────────────────────────────────────

def push_classroom(alumno_nombre: str, items: list[dict]) -> bool:
    """Persiste items de Classroom en Supabase."""
    url = (os.getenv("SUPABASE_URL") or "").strip()
    key = (os.getenv("SUPABASE_SERVICE_KEY") or "").strip()
    if not url or not key:
        print("[WARN] Supabase no configurado, skip push classroom")
        return False

    try:
        from supabase import create_client
        sb = create_client(url, key)

        # Borrar y reinsertar (estado completo de Classroom)
        sb.table("classroom").delete().eq("alumno", alumno_nombre).execute()

        if not items:
            print(f"[OK] {alumno_nombre}: sin items Classroom que guardar")
            return True

        rows = []
        for item in items:
            rows.append({
                "alumno": alumno_nombre,
                "curso": item.get("curso", ""),
                "titulo": item.get("titulo", "")[:300],
                "tipo": item.get("tipo", "tarea"),
                "fecha_entrega": item.get("fecha_entrega"),
                "estado": item.get("estado", "pendiente"),
                "calificacion": item.get("calificacion"),
                "link": item.get("link", "")[:500],
                "descripcion": item.get("descripcion", "")[:300],
            })

        sb.table("classroom").insert(rows).execute()
        print(f"[OK] {alumno_nombre}: {len(rows)} items Classroom guardados")

        # También insertar tareas pendientes con fecha en items_colegio
        fechas_rows = []
        for item in items:
            if item.get("fecha_entrega") and item.get("estado") in ("pendiente", "atrasado"):
                fechas_rows.append({
                    "alumno": alumno_nombre,
                    "categoria": "fecha_proxima",
                    "titulo": item["titulo"],
                    "detalle": f"Classroom: {item.get('curso', '')}",
                    "fecha_evento": item["fecha_entrega"],
                    "asignatura": item.get("curso", ""),
                })

        if fechas_rows:
            # Borrar classroom items previos en items_colegio para este alumno
            sb.table("items_colegio").delete().eq("alumno", alumno_nombre).eq("categoria", "fecha_proxima").like("detalle", "Classroom:%").execute()
            sb.table("items_colegio").insert(fechas_rows).execute()
            print(f"[OK] {alumno_nombre}: {len(fechas_rows)} fechas Classroom en calendario")

        return True

    except Exception as e:
        print(f"[ERROR] Supabase push classroom: {e}")
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Pipeline principal
# ─────────────────────────────────────────────────────────────────────────────

async def extract_alumno(alumno: dict, force_login: bool = False) -> list[dict]:
    """Extrae todos los cursos y tareas de un alumno."""
    print(f"\n{'='*60}")
    print(f"[Classroom] {alumno['nombre']} ({alumno['email']})")
    print(f"{'='*60}")

    async with async_playwright() as pw:
        ctx = await get_context(pw, alumno, force_visible=force_login)
        page = await ctx.new_page()

        try:
            if force_login:
                ok = await login_manual(page, alumno)
                if not ok:
                    return []
            else:
                ok = await ensure_logged_in(page, alumno)
                if not ok:
                    return []

            # Obtener cursos
            courses = await get_courses(page)
            if not courses:
                print(f"[WARN] No se encontraron cursos para {alumno['nombre']}")
                return []

            # Extraer tareas de cada curso
            all_items = []
            for course in courses:
                assignments = await get_course_assignments(page, course)
                # Parsear fechas
                for a in assignments:
                    a["curso"] = course["nombre"]
                    a["fecha_entrega"] = parse_fecha_classroom(a.pop("fecha_texto", ""))
                all_items.extend(assignments)

                # Anuncios (opcional, puede ser ruidoso)
                # announcements = await get_course_announcements(page, course)
                # for ann in announcements:
                #     ann["curso"] = course["nombre"]
                #     ann["fecha_entrega"] = parse_fecha_classroom(ann.pop("fecha_texto", ""))
                # all_items.extend(announcements)

            print(f"\n[RESUMEN] {alumno['nombre']}: {len(all_items)} items en {len(courses)} cursos")

            # Guardar JSON debug
            debug_path = OUTPUT_DIR / f"debug_classroom_{alumno['slug']}.json"
            debug_path.write_text(
                json.dumps(all_items, ensure_ascii=False, indent=2, default=str),
                encoding="utf-8"
            )
            print(f"[DEBUG] Guardado en {debug_path}")

            return all_items

        finally:
            await ctx.close()


async def main():
    force_login = "--login" in sys.argv

    # Determinar qué alumnos procesar
    filtro = None
    for arg in sys.argv[1:]:
        if arg.lower() in ("clemente", "raimundo"):
            filtro = arg.lower()
            break

    alumnos = ALUMNOS_CONFIG
    if filtro:
        alumnos = [a for a in alumnos if a["slug"] == filtro]

    if not alumnos:
        print("[ERROR] No hay alumnos configurados con CLASSROOM email en .env")
        print("        Configura ALUMNO_1_CLASSROOM y/o ALUMNO_2_CLASSROOM en .env")
        sys.exit(1)

    for alumno in alumnos:
        items = await extract_alumno(alumno, force_login=force_login)
        push_classroom(alumno["nombre"], items)


if __name__ == "__main__":
    asyncio.run(main())
