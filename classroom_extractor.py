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

def find_chrome_executable() -> str | None:
    """Busca Chrome instalado en el sistema (Windows)."""
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expanduser(r"~\AppData\Local\Google\Chrome\Application\chrome.exe"),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return None


async def get_context(playwright, alumno: dict, force_visible: bool = False) -> BrowserContext:
    """Devuelve contexto con sesión persistente para el alumno.
    Usa Chrome real del sistema si está disponible (mejor compatibilidad con Classroom).
    """
    session_dir = alumno["session_dir"]
    session_dir.mkdir(parents=True, exist_ok=True)

    headless = HEADLESS and not force_visible

    chrome_exe = find_chrome_executable()
    kwargs = dict(
        headless=headless,
        args=[
            "--disable-blink-features=AutomationControlled",
            "--no-first-run",
            "--no-default-browser-check",
        ],
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/131.0.0.0 Safari/537.36"
        ),
        viewport={"width": 1280, "height": 900},
        locale="es-CL",
        ignore_default_args=["--enable-automation"],
        # Bloquear service workers para que las peticiones de red no sean servidas
        # desde caché de SW — así capturamos dpT4Vd (coursework items) siempre.
        service_workers="block",
    )
    if chrome_exe:
        print(f"[INFO] Usando Chrome del sistema: {chrome_exe}")
        kwargs["executable_path"] = chrome_exe
    else:
        print("[WARN] Chrome no encontrado, usando Chromium de Playwright")

    ctx = await playwright.chromium.launch_persistent_context(str(session_dir), **kwargs)
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


async def get_course_items(page: Page, course: dict) -> list[dict]:
    """
    Extrae tareas y materiales de un curso de Classroom.
    Estrategia 1: DOM scraping de [data-stream-item-id] (los ítems usan click handlers, no <a href>).
    Estrategia 2: Parseo de batchexecute dpT4Vd (hrcw.qr) como respaldo.
    """
    course_id = course["id"]
    all_batch: list[dict] = []

    # Evento para saber cuándo llega dpT4Vd (la respuesta con los ítems de classwork)
    dpT4Vd_received = asyncio.Event()

    async def handle_response(response):
        if "batchexecute" in response.url:
            try:
                text = await response.text()
                rpcids = response.url.split("rpcids=")[1].split("&")[0] if "rpcids=" in response.url else ""
                all_batch.append({"rpcids": rpcids, "body": text, "body_len": len(text)})
                if rpcids == "dpT4Vd" and len(text) > 200:
                    dpT4Vd_received.set()
            except Exception:
                pass

    page.on("response", handle_response)

    try:
        await page.goto(f"https://classroom.google.com/c/{course_id}/t/all",
                        wait_until="load", timeout=40000)
    except Exception:
        await page.goto(f"https://classroom.google.com/c/{course_id}/t/all",
                        wait_until="domcontentloaded", timeout=40000)

    # Traer la ventana al frente para activar Page Visibility API
    try:
        await page.bring_to_front()
    except Exception:
        pass

    # Esperar que la SPA inicialice el JavaScript del classwork tab
    await asyncio.sleep(5)
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    await asyncio.sleep(2)
    await page.evaluate("window.scrollTo(0, 0)")
    await asyncio.sleep(1)

    # Si dpT4Vd no llegó todavía, navegar al stream del curso también
    # (el stream dispara dpT4Vd con los items recientes del alumno)
    if not dpT4Vd_received.is_set():
        try:
            await page.goto(f"https://classroom.google.com/c/{course_id}",
                            wait_until="load", timeout=30000)
        except Exception:
            pass
        await asyncio.sleep(5)
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await asyncio.sleep(2)
        await page.evaluate("window.scrollTo(0, 0)")
        await asyncio.sleep(1)

    # Esperar a que llegue dpT4Vd (hasta 10 segundos más)
    try:
        await asyncio.wait_for(dpT4Vd_received.wait(), timeout=10.0)
        print(f"     [DEBUG] dpT4Vd recibido ✓")
        await asyncio.sleep(1.5)  # Esperar que JS renderice los ítems
    except asyncio.TimeoutError:
        print(f"     [DEBUG] dpT4Vd no llegó")

    # Debug: cuántas llamadas batchexecute se capturaron
    rpc_list = [c["rpcids"] for c in all_batch]
    print(f"     [DEBUG] {len(all_batch)} batchexecute: {rpc_list}")

    # Debug: contar ítems en DOM
    cnt = await page.evaluate("document.querySelectorAll('[data-stream-item-id]').length")
    print(f"     [DEBUG] items en DOM: {cnt}")

    page.remove_listener("response", handle_response)

    # ── Estrategia 1: DOM con data-stream-item-id ──────────────────────────────
    # Google Classroom usa data-stream-item-id en los contenedores de posts.
    # Los posts del profe (materiales/recursos) contienen links inline a Drive/Docs.
    # Los extraemos directamente del DOM del stream, sin navegar a páginas de detalle.
    items = await page.evaluate("""() => {
        const result = [];
        const seen = new Set();
        const seenLinks = new Set();
        const courseId = location.pathname.split('/')[2];

        const CONTENT_DOMAINS = [
            'drive.google.com', 'docs.google.com', 'slides.google.com',
            'forms.google.com', 'youtube.com/watch', 'youtu.be/',
            'sites.google.com'
        ];

        function resolveClassroomUrl(href) {
            // Desempaquetar google.com/url?q=... redirect
            try {
                if (href.includes('google.com/url')) {
                    const u = new URL(href);
                    const q = u.searchParams.get('q') || u.searchParams.get('url');
                    if (q) return q;
                }
            } catch(e) {}
            return href;
        }

        function extractMaterials(div) {
            const mats = [];
            const links = [...div.querySelectorAll('a[href]')];
            for (const a of links) {
                const rawHref = a.href || '';
                const href = resolveClassroomUrl(rawHref);
                const isContent = CONTENT_DOMAINS.some(d => href.includes(d)) ||
                                  /\\.pdf([?#]|$)/.test(href);
                if (!isContent || seenLinks.has(href)) continue;
                seenLinks.add(href);

                let tipo = 'archivo';
                if (href.includes('docs.google.com/document')) tipo = 'documento';
                else if (href.includes('docs.google.com/presentation') || href.includes('slides.google.com')) tipo = 'presentacion';
                else if (href.includes('docs.google.com/spreadsheets')) tipo = 'hoja';
                else if (href.includes('docs.google.com/forms') || href.includes('forms.google.com')) tipo = 'formulario';
                else if (href.includes('youtube.com') || href.includes('youtu.be')) tipo = 'video';
                else if (href.includes('sites.google.com')) tipo = 'sitio';
                else if (href.includes('drive.google.com')) tipo = 'drive';
                else if (/\\.pdf/.test(href)) tipo = 'pdf';

                const container = a.closest('[aria-label], [data-tooltip]') || a;
                let nombre = (
                    container.getAttribute('aria-label') ||
                    container.getAttribute('data-tooltip') ||
                    a.getAttribute('aria-label') ||
                    a.getAttribute('title') ||
                    a.textContent
                ).replace(/\\s+/g, ' ').trim();
                nombre = nombre
                    .replace(/^(abrir|open|ver|view)\\s+/i, '')
                    .replace(/^Archivo adjunto:\\s*/i, '')
                    .replace(/^Adjunto:\\s*/i, '')
                    .trim();
                if (!nombre || nombre.length < 2 || nombre.length > 200) {
                    // Fallback: usar tipo + ID de Drive para identificar el archivo
                    const driveMatch = href.match(/[/]d[/]([A-Za-z0-9_-]{10,})[/]/);
                    if (driveMatch) {
                        nombre = `Archivo Drive (${driveMatch[1].substring(0, 8)}...)`;
                    } else {
                        nombre = href.split('/').filter(s => s.length > 8 && !['view','edit','preview'].includes(s)).pop()?.split('?')[0] || 'Archivo';
                    }
                }

                mats.push({ url: href, tipo, nombre });
            }
            return mats;
        }

        const itemDivs = [...document.querySelectorAll('[data-stream-item-id]')];
        for (const div of itemDivs) {
            const itemId = div.getAttribute('data-stream-item-id');
            if (!itemId || seen.has(itemId)) continue;
            seen.add(itemId);

            // Título: buscar heading o texto principal del ítem
            let titulo = '';
            const heading = div.querySelector('[jsname="rQC7Ie"], [class*="VOnTrc"], [class*="title"]');
            if (heading) titulo = heading.textContent.trim();
            if (!titulo) titulo = div.querySelector('h1,h2,h3')?.textContent.trim() || '';
            if (!titulo) titulo = div.textContent.replace(/\\s+/g, ' ').trim().substring(0, 120);
            if (!titulo || titulo.length < 2) continue;

            const innerHtml = div.innerHTML.toLowerCase();
            const text = div.textContent.toLowerCase();

            // Tipo
            let tipo = 'tarea';
            if (innerHtml.includes('material') && !innerHtml.includes('entregado')) tipo = 'material';

            // Estado
            let estado = tipo === 'material' ? 'informativo' : 'pendiente';
            if (text.includes('entregado') || text.includes('submitted')) estado = 'entregado';
            else if (text.includes('calificado') || text.includes('graded')) estado = 'calificado';
            else if (text.includes('atrasado') || text.includes('missing') || text.includes('late')) estado = 'atrasado';

            // Fecha
            let fecha_texto = '';
            const fechaEl = div.querySelector('[class*="due"], [class*="fecha"], time');
            if (fechaEl) fecha_texto = (fechaEl.getAttribute('datetime') || fechaEl.textContent).trim();

            // Calificación
            let calificacion = null;
            const calEl = div.querySelector('[class*="grade"], [class*="nota"], [class*="NwH0nc"]');
            if (calEl) {
                const calText = calEl.textContent.trim();
                if (calText && /\\d/.test(calText)) calificacion = calText;
            }

            // Materiales inline (Drive/Docs links dentro del stream post)
            const materiales_inline = extractMaterials(div);

            const link = `https://classroom.google.com/c/${courseId}/a/${itemId}/details`;
            result.push({ titulo, tipo, fecha_texto, estado, calificacion, link, materiales_inline });
        }
        return result;
    }""")

    # ── Estrategia 2: Parseo de batchexecute dpT4Vd ───────────────────────────
    if not items:
        items = _parse_batch_items(all_batch, course_id)

    tareas    = [i for i in items if i["tipo"] == "tarea"]
    materiales = [i for i in items if i["tipo"] == "material"]
    n_inline = sum(len(i.get("materiales_inline", [])) for i in items)
    print(f"     [{course['nombre']}] {len(tareas)} tareas, {len(materiales)} materiales ({n_inline} archivos inline)")
    return items


def _parse_batch_items(all_batch: list[dict], course_id: str) -> list[dict]:
    """
    Parsea respuestas dpT4Vd (hrcw.qr) de batchexecute para extraer coursework items.
    Úsado como fallback si el DOM no tiene data-stream-item-id.
    """
    items = []
    seen: set[str] = set()

    for call in all_batch:
        if call["rpcids"] != "dpT4Vd" or call["body_len"] < 200:
            continue
        body = call["body"]
        try:
            # El cuerpo tiene formato: )]}'\n\nSIZE\n[[JSON]]\n25\n[[TAIL]]\n
            stripped = re.sub(r"^\)\]\}'\s*", "", body).lstrip()
            m = re.search(r"\d+\n(\[.*?\])\n\d+\n", stripped, re.DOTALL)
            if not m:
                continue
            outer = json.loads(m.group(1))
            inner = json.loads(outer[0][2])
            # inner = ["hrcw.qr", [false], [[wrapper1], [wrapper2], ...]]
            if not inner or len(inner) < 3:
                continue
            for wrapper in inner[2]:
                if not wrapper or len(wrapper) < 6 or not wrapper[5]:
                    continue
                item_data = wrapper[5][0] if wrapper[5] else None
                if not item_data or len(item_data) < 6:
                    continue
                item_id = str(item_data[0][0]) if item_data[0] else None
                title   = item_data[5] if len(item_data) > 5 and isinstance(item_data[5], str) else None
                if not title or not item_id or item_id in seen:
                    continue
                seen.add(item_id)
                # Estado: item_data[8] → 2=entregado, 1=pendiente
                state_num = item_data[8] if len(item_data) > 8 else None
                estado = "entregado" if state_num == 2 else "pendiente"
                link = f"https://classroom.google.com/c/{course_id}/a/{item_id}/details"
                items.append({"titulo": title, "tipo": "tarea",
                               "fecha_texto": "", "estado": estado,
                               "calificacion": None, "link": link})
        except Exception:
            continue
    return items


async def get_assignment_materials(page: Page, assignment: dict) -> list[dict]:
    """
    Navega a la página de detalle de una tarea o material y extrae los archivos adjuntos.
    Funciona con tareas (/a/), materiales (/r/) y preguntas (/p/).
    Retorna: [{nombre, url, tipo}]
    Solo captura links a Google Drive/Docs/PDFs/YouTube — no links de navegación.
    Intenta ambos paths /a/ y /r/ para capturar tanto tareas como materiales del profe.
    """
    link = assignment.get("link", "")
    if not link or "/c/" not in link:
        return []

    # Determinar paths a intentar según el tipo del item
    tipo = assignment.get("tipo", "tarea")
    if tipo == "material":
        # Materiales del profe: intentar /r/ primero, luego /a/
        alt_link = link.replace("/a/", "/r/")
        links_to_try = [alt_link, link] if alt_link != link else [link]
    else:
        # Tareas: intentar /a/ primero, luego /r/
        alt_link = link.replace("/a/", "/r/")
        links_to_try = [link, alt_link] if alt_link != link else [link]

    materials = []
    for try_link in links_to_try:
        try:
            await page.goto(try_link, wait_until="domcontentloaded", timeout=20000)
            await asyncio.sleep(2)
        except Exception as e:
            continue

        materials = await _extract_page_materials(page)
        if materials:
            break  # Encontramos materiales, no hace falta intentar el otro path

    return materials


async def _extract_page_materials(page: Page) -> list[dict]:
    """
    Extrae links a Drive/Docs/YouTube de la página actual.
    Helper usado por get_assignment_materials.
    """
    return await page.evaluate("""() => {
        const result = [];
        const seen = new Set();

        const links = [...document.querySelectorAll('a[href]')];
        for (const a of links) {
            const href = a.href || '';

            // Solo links a servicios Google o archivos directos (no navegación interna)
            const isContent = (
                href.includes('drive.google.com') ||
                href.includes('docs.google.com') ||
                href.includes('slides.google.com') ||
                href.includes('forms.google.com') ||
                href.includes('youtube.com/watch') ||
                href.includes('youtu.be/') ||
                href.includes('sites.google.com') ||
                /\\.pdf([?#]|$)/.test(href)
            );
            if (!isContent) continue;
            if (seen.has(href)) continue;
            seen.add(href);

            // Tipo de material
            let tipo = 'archivo';
            if (href.includes('docs.google.com/document')) tipo = 'documento';
            else if (href.includes('docs.google.com/presentation') || href.includes('slides.google.com')) tipo = 'presentacion';
            else if (href.includes('docs.google.com/spreadsheets')) tipo = 'hoja';
            else if (href.includes('docs.google.com/forms') || href.includes('forms.google.com')) tipo = 'formulario';
            else if (href.includes('youtube.com') || href.includes('youtu.be')) tipo = 'video';
            else if (href.includes('sites.google.com')) tipo = 'sitio';
            else if (href.includes('drive.google.com')) tipo = 'drive';
            else if (/\\.pdf/.test(href)) tipo = 'pdf';

            // Nombre: prioridad aria-label → texto del link
            const container = a.closest('[aria-label], [data-tooltip]') || a;
            let nombre = (
                container.getAttribute('aria-label') ||
                container.getAttribute('data-tooltip') ||
                a.getAttribute('aria-label') ||
                a.getAttribute('title') ||
                a.textContent
            ).replace(/\\s+/g, ' ').trim();

            // Quitar prefijos genéricos de Google
            nombre = nombre.replace(/^(abrir|open|ver|view)\\s+/i, '').trim();
            if (!nombre || nombre.length < 2 || nombre.length > 200) continue;

            result.push({ nombre, url: href, tipo });
        }
        return result;
    }""")


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


def push_classroom_materiales(alumno_nombre: str, materiales: list[dict]) -> bool:
    """Persiste materiales de tareas Classroom en Supabase."""
    url = (os.getenv("SUPABASE_URL") or "").strip()
    key = (os.getenv("SUPABASE_SERVICE_KEY") or "").strip()
    if not url or not key:
        return False

    try:
        from supabase import create_client
        sb = create_client(url, key)

        sb.table("classroom_materiales").delete().eq("alumno", alumno_nombre).execute()

        if not materiales:
            return True

        rows = []
        for m in materiales:
            rows.append({
                "alumno": alumno_nombre,
                "curso": m.get("curso", ""),
                "tarea_titulo": m.get("tarea_titulo", "")[:300],
                "tarea_link": m.get("tarea_link", "")[:500],
                "nombre": m.get("nombre", "")[:300],
                "url": m.get("url", "")[:500],
                "tipo": m.get("tipo", "archivo"),
            })

        sb.table("classroom_materiales").insert(rows).execute()
        print(f"[OK] {alumno_nombre}: {len(rows)} materiales Classroom guardados")
        return True

    except Exception as e:
        print(f"[ERROR] Supabase push materiales: {e}")
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Pipeline principal
# ─────────────────────────────────────────────────────────────────────────────

async def extract_alumno(alumno: dict, force_login: bool = False, deep: bool = True) -> tuple[list[dict], list[dict]]:
    """
    Extrae cursos, tareas y materiales adjuntos de un alumno.
    deep=True (default): navega dentro de cada tarea para extraer archivos adjuntos.
    Retorna (items, materiales).
    """
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
                    return [], []
            else:
                ok = await ensure_logged_in(page, alumno)
                if not ok:
                    return [], []

            # Obtener cursos
            courses = await get_courses(page)
            if not courses:
                print(f"[WARN] No se encontraron cursos para {alumno['nombre']}")
                return [], []

            # Extraer tareas Y materiales de cada curso
            all_items = []
            for course in courses:
                items = await get_course_items(page, course)
                for a in items:
                    a["curso"] = course["nombre"]
                    a["fecha_entrega"] = parse_fecha_classroom(a.pop("fecha_texto", ""))
                all_items.extend(items)

            n_tareas = sum(1 for i in all_items if i["tipo"] == "tarea")
            n_mats   = sum(1 for i in all_items if i["tipo"] == "material")
            print(f"\n[RESUMEN] {alumno['nombre']}: {n_tareas} tareas + {n_mats} materiales en {len(courses)} cursos")

            # Recopilar materiales inline extraídos directamente del stream DOM
            # (Drive/Docs links visibles en el post del profe, sin navegar a páginas extra)
            all_materiales = []
            for item in all_items:
                inline = item.pop("materiales_inline", [])
                for m in inline:
                    m["curso"] = item["curso"]
                    m["tarea_titulo"] = item["titulo"]
                    m["tarea_link"] = item.get("link", "")
                all_materiales.extend(inline)

            n_inline = len(all_materiales)
            print(f"[INFO] {n_inline} archivos inline encontrados en el stream")

            # Si deep=True, además navegar a tareas pendientes para extraer sus adjuntos
            if deep and all_items:
                items_tareas = [i for i in all_items if i.get("tipo") == "tarea"
                                and i.get("estado") in ("pendiente", "atrasado")][:15]
                if items_tareas:
                    print(f"[INFO] Extrayendo adjuntos de {len(items_tareas)} tareas pendientes...")
                    for item in items_tareas:
                        mats = await get_assignment_materials(page, item)
                        for m in mats:
                            m["curso"] = item["curso"]
                            m["tarea_titulo"] = item["titulo"]
                            m["tarea_link"] = item.get("link", "")
                        if mats:
                            print(f"       {item['titulo'][:50]}: {len(mats)} archivos")
                        all_materiales.extend(mats)

            print(f"[RESUMEN] {len(all_materiales)} materiales totales")

            # Guardar JSON debug
            debug_path = OUTPUT_DIR / f"debug_classroom_{alumno['slug']}.json"
            debug_path.write_text(
                json.dumps({"items": all_items, "materiales": all_materiales},
                           ensure_ascii=False, indent=2, default=str),
                encoding="utf-8"
            )
            print(f"[DEBUG] Guardado en {debug_path}")

            return all_items, all_materiales

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

    deep = "--no-deep" not in sys.argv  # deep por defecto, desactivar con --no-deep

    for alumno in alumnos:
        items, materiales = await extract_alumno(alumno, force_login=force_login, deep=deep)
        push_classroom(alumno["nombre"], items)
        push_classroom_materiales(alumno["nombre"], materiales)


if __name__ == "__main__":
    asyncio.run(main())
