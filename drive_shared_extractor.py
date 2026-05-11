"""
drive_shared_extractor.py - Extractor de Google Drive "Compartido conmigo"
==========================================================================
Usa la misma sesión persistente de Playwright que classroom_extractor.py.
No requiere OAuth — accede con las cookies ya guardadas del alumno.

Extrae todos los archivos que los profes compartieron con el alumno:
  - PDFs (pruebas, guías, pautas, temarios)
  - Presentaciones PowerPoint / Google Slides
  - Documentos Word / Google Docs
  - Cualquier otro archivo compartido

Descarga los archivos relevantes a ./drive_downloads/{alumno}/
Persiste metadatos en tabla Supabase `classroom_materiales`.

Uso:
    python drive_shared_extractor.py              # todos los alumnos
    python drive_shared_extractor.py clemente     # solo Clemente
    python drive_shared_extractor.py --download   # descargar archivos también
    python drive_shared_extractor.py --debug      # dump estructura DOM primer item
"""

import asyncio
import json
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv
from playwright.async_api import async_playwright, Page, BrowserContext

load_dotenv()

OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "."))
HEADLESS = os.getenv("HEADLESS", "false").lower() == "true"
DOWNLOAD_DIR = OUTPUT_DIR / "drive_downloads"

DRIVE_SHARED_URL = "https://drive.google.com/drive/shared-with-me"


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
            # Reutilizar la misma sesión de classroom_extractor.py
            "session_dir": OUTPUT_DIR / f".browser_classroom_{nombre.split()[0].lower()}",
        })


# ─────────────────────────────────────────────────────────────────────────────
# Playwright helpers (reutilizados de classroom_extractor.py)
# ─────────────────────────────────────────────────────────────────────────────

def find_chrome_executable() -> str | None:
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expanduser(r"~\AppData\Local\Google\Chrome\Application\chrome.exe"),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return None


async def get_context(playwright, alumno: dict) -> BrowserContext:
    session_dir = alumno["session_dir"]
    session_dir.mkdir(parents=True, exist_ok=True)

    chrome_exe = find_chrome_executable()
    kwargs = dict(
        headless=HEADLESS,
        accept_downloads=True,
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
    )
    if chrome_exe:
        print(f"[INFO] Usando Chrome del sistema: {chrome_exe}")
        kwargs["executable_path"] = chrome_exe

    ctx = await playwright.chromium.launch_persistent_context(str(session_dir), **kwargs)
    return ctx


# ─────────────────────────────────────────────────────────────────────────────
# Extracción de Drive "Compartido conmigo"
# ─────────────────────────────────────────────────────────────────────────────

async def switch_to_list_view(page: Page):
    """Cambia Drive a vista de lista si está en cuadrícula — nombres más limpios."""
    try:
        # Botón de vista lista: aria-label "Cambiar a diseño de lista" o similar
        btn = page.locator('[data-tooltip*="lista"], [aria-label*="lista"], [aria-label*="list"]').first
        visible = await btn.is_visible()
        if visible:
            await btn.click()
            await asyncio.sleep(1.5)
            print("[INFO] Cambiado a vista de lista")
    except Exception:
        pass  # Ya está en lista o no encontró el botón


async def load_all_items(page: Page, max_scrolls: int = 20):
    """Desplaza para cargar todos los ítems (Drive carga en lotes al scroll)."""
    prev_count = 0
    for i in range(max_scrolls):
        count = await page.evaluate("document.querySelectorAll('[data-id]').length")
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await asyncio.sleep(1.5)

        new_count = await page.evaluate("document.querySelectorAll('[data-id]').length")
        if new_count == prev_count:
            break
        prev_count = new_count
        print(f"     [scroll {i+1}] {new_count} ítems cargados...")

    print(f"[INFO] Total ítems en DOM: {prev_count}")


async def debug_first_item(page: Page):
    """Dump de la estructura del primer [data-id] para diagnosticar selectores."""
    result = await page.evaluate("""() => {
        const el = document.querySelector('[data-id]');
        if (!el) return {error: 'No [data-id] found'};
        return {
            id: el.getAttribute('data-id'),
            outerHTML: el.outerHTML.substring(0, 3000),
            attributes: [...el.attributes].map(a => ({name: a.name, value: a.value.substring(0, 200)})),
            childrenCount: el.children.length,
            textContent: el.textContent.replace(/\\s+/g, ' ').trim().substring(0, 500),
            // Buscar elementos con data-tooltip dentro
            tooltips: [...el.querySelectorAll('[data-tooltip]')].map(t => ({
                tag: t.tagName,
                tooltip: t.getAttribute('data-tooltip'),
                text: t.textContent.trim().substring(0, 100)
            })),
            // aria-labels dentro
            ariaLabels: [...el.querySelectorAll('[aria-label]')].map(a => ({
                tag: a.tagName,
                label: a.getAttribute('aria-label').substring(0, 200)
            })),
            // spans con texto
            spans: [...el.querySelectorAll('span')].slice(0, 10).map(s => ({
                classes: s.className.substring(0, 100),
                text: s.textContent.trim().substring(0, 100)
            }))
        };
    }""")
    sys.stdout.buffer.write(b"\n=== DEBUG PRIMER ITEM [data-id] ===\n")
    sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False, indent=2).encode("utf-8", "replace"))
    sys.stdout.buffer.write(b"\n=== FIN DEBUG ===\n\n")
    sys.stdout.buffer.flush()


def _extract_name_from_element_js() -> str:
    """
    Código JS que extrae el nombre limpio de un elemento [data-id] de Drive.
    Basado en el DOM real de Drive lista:
      - El nombre está en div.MxB3Nd (jsname="vtaz5c")
      - El aria-label tiene formato: "{name} {FileType} Más información (Alt + →)"
      - El tipo está en el <title> del SVG icono
    """
    return """
    function extractName(el) {
        // Estrategia 1 (más confiable): div con clase MxB3Nd contiene solo el nombre
        const nameDiv = el.querySelector('.MxB3Nd, [jsname="vtaz5c"]');
        if (nameDiv) {
            const t = nameDiv.textContent.trim();
            if (t && t.length > 0 && t.length < 300) return t;
        }

        // Estrategia 2: aria-label — quitar sufijo " {Tipo} Más información (Alt + →)"
        let label = el.getAttribute('aria-label') || '';
        if (label) {
            // Quitar el sufijo: " Más información (Alt + →)" y lo que le precede (el tipo de archivo)
            label = label.replace(/\\s+(Más información|More info).*$/i, '').trim();
            // Quitar sufijo del tipo de archivo (última palabra si no es parte del nombre)
            const knownTypes = ['PDF', 'Vídeo', 'Video', 'Audio', 'Imagen', 'Image',
                                'Microsoft PowerPoint', 'Microsoft Word', 'Microsoft Excel',
                                'Presentaciones de Google', 'Documentos de Google',
                                'Hojas de cálculo de Google', 'Google Slides', 'Google Docs',
                                'Google Sheets', 'Google Forms', 'Formularios de Google'];
            for (const t of knownTypes) {
                if (label.endsWith(' ' + t)) {
                    label = label.slice(0, -(t.length + 1)).trim();
                    break;
                }
            }
            if (label && label.length > 0 && label.length < 300) return label;
        }

        return '';
    }

    function extractFileType(el) {
        // El tipo viene en el <title> del SVG icono del archivo
        const svgTitle = el.querySelector('svg title');
        if (svgTitle) return svgTitle.textContent.trim();

        // O en aria-label: "{name} {FileType} Más información..."
        const label = el.getAttribute('aria-label') || '';
        const m = label.match(/\\s+(PDF|Vídeo|Video|Audio|Imagen|Microsoft PowerPoint|Microsoft Word|Microsoft Excel|Presentaciones de Google|Documentos de Google|Hojas de cálculo de Google|Google Slides|Google Docs|Google Sheets|Formularios de Google|MOV|MP4|MP3|WAV)\\s+/i);
        if (m) return m[1];

        return '';
    }
    """


async def extract_shared_files(page: Page, debug: bool = False) -> list[dict]:
    """
    Extrae todos los archivos de Drive "Compartido conmigo".
    Retorna lista de {id, name, mime, url, tipo}.
    """
    await page.goto(DRIVE_SHARED_URL, wait_until="domcontentloaded", timeout=30000)
    await asyncio.sleep(4)

    # Verificar sesión
    if "accounts.google.com" in page.url or "signin" in page.url.lower():
        print("[ERROR] No hay sesión de Drive activa. Corre primero: python classroom_extractor.py --login")
        return []

    print(f"[OK] Drive cargado: {page.url}")

    # Cambiar a vista lista para mejor extracción
    await switch_to_list_view(page)

    # Cargar todos los ítems
    await load_all_items(page)

    if debug:
        await debug_first_item(page)

    # Extraer todos los archivos
    extract_name_js = _extract_name_from_element_js()
    files = await page.evaluate(f"""() => {{
        {extract_name_js}

        function mimeToTipo(mime, name, fileTypeTxt) {{
            if (!mime) mime = '';
            if (!name) name = '';
            if (!fileTypeTxt) fileTypeTxt = '';
            const n = name.toLowerCase();
            const m = mime.toLowerCase();
            const ft = fileTypeTxt.toLowerCase();

            if (m.includes('pdf') || n.endsWith('.pdf') || ft === 'pdf') return 'pdf';
            if (m.includes('presentation') || m.includes('powerpoint') ||
                n.endsWith('.pptx') || n.endsWith('.ppt') ||
                ft.includes('powerpoint') || ft.includes('presentacion') || ft.includes('slides')) return 'presentacion';
            if (m.includes('document') || m.includes('word') ||
                n.endsWith('.docx') || n.endsWith('.doc') ||
                ft.includes('word') || ft.includes('documento') || ft.includes('docs')) return 'documento';
            if (m.includes('spreadsheet') || m.includes('excel') ||
                n.endsWith('.xlsx') || n.endsWith('.xls') ||
                ft.includes('excel') || ft.includes('hoja') || ft.includes('sheets')) return 'hoja';
            if (m.includes('audio') || n.match(/\\.(mp3|wav|ogg|m4a|aac)$/) ||
                ft.includes('audio') || ft.includes('mp3') || ft.includes('wav')) return 'audio';
            if (m.includes('video') || n.match(/\\.(mp4|avi|mov|mkv)$/) ||
                ft.includes('video') || ft.includes('vídeo') || ft.includes('mov') || ft.includes('mp4')) return 'video';
            if (m.includes('image') || n.match(/\\.(jpg|jpeg|png|gif|webp)$/) ||
                ft.includes('image') || ft.includes('imagen')) return 'imagen';
            if (m.includes('form') || ft.includes('form')) return 'formulario';
            if (m.includes('site')) return 'sitio';
            return 'drive';
        }}

        const result = [];
        const seen = new Set();
        const items = [...document.querySelectorAll('[data-id]')];

        for (const el of items) {{
            const id = el.getAttribute('data-id');
            if (!id || id.length < 10 || seen.has(id)) continue;
            seen.add(id);

            const name = extractName(el);
            if (!name) continue;

            // Tipo de archivo desde SVG title o aria-label
            const fileTypeTxt = extractFileType(el);

            // Obtener mime type — puede estar en atributo data-mime-type o en un img src de ícono
            let mime = el.getAttribute('data-mime-type') || '';
            if (!mime) {{
                // Buscar en íconos de Drive (la clase del svg/img suele indicar el tipo)
                const iconEl = el.querySelector('[data-mime-type]');
                if (iconEl) mime = iconEl.getAttribute('data-mime-type') || '';
            }}
            if (!mime) {{
                // Inferir por extensión del nombre
                const ext = name.split('.').pop()?.toLowerCase() || '';
                if (ext === 'pdf') mime = 'application/pdf';
                else if (['pptx','ppt'].includes(ext)) mime = 'application/vnd.ms-powerpoint';
                else if (['docx','doc'].includes(ext)) mime = 'application/msword';
                else if (['xlsx','xls'].includes(ext)) mime = 'application/vnd.ms-excel';
                else if (['mp3','wav','ogg','m4a'].includes(ext)) mime = 'audio/' + ext;
                else if (['mp4','mov','avi'].includes(ext)) mime = 'video/' + ext;
            }}

            const tipo = mimeToTipo(mime, name, fileTypeTxt);
            const url = `https://drive.google.com/file/d/${{id}}/view`;

            result.push({{ id, name, mime, fileType: fileTypeTxt, url, tipo }});
        }}

        return result;
    }}""")

    print(f"[OK] {len(files)} archivos encontrados en 'Compartido conmigo'")

    # Clasificar y mostrar resumen
    tipos = {}
    for f in files:
        tipos[f["tipo"]] = tipos.get(f["tipo"], 0) + 1
    for tipo, count in sorted(tipos.items(), key=lambda x: -x[1]):
        print(f"     - {tipo}: {count}")

    return files


# ─────────────────────────────────────────────────────────────────────────────
# Clasificación de archivos educativos
# ─────────────────────────────────────────────────────────────────────────────

PALABRAS_PRUEBA = [
    "prueba", "control", "evaluacion", "evaluación", "examen", "test",
    "certamen", "quiz", "solemne",
]
PALABRAS_PAUTA = [
    "pauta", "solucionario", "respuestas", "corrección", "correccion",
    "rúbrica", "rubrica",
]
PALABRAS_GUIA = [
    "guía", "guia", "actividad", "ejercicio", "taller", "práctica",
    "practica", "worksheet", "ficha",
]
PALABRAS_TEMARIO = [
    "temario", "contenidos", "materia", "unidad", "planificacion",
    "planificación",
]

TIPOS_DESCARGABLES = {"pdf", "presentacion", "documento", "hoja", "audio"}


def clasificar_archivo(f: dict) -> str:
    """Clasifica el archivo educativo por nombre."""
    name = f.get("name", "").lower()
    if any(p in name for p in PALABRAS_PRUEBA):
        return "prueba"
    if any(p in name for p in PALABRAS_PAUTA):
        return "pauta"
    if any(p in name for p in PALABRAS_GUIA):
        return "guia"
    if any(p in name for p in PALABRAS_TEMARIO):
        return "temario"
    return "material"


def es_descargable(f: dict) -> bool:
    return f.get("tipo") in TIPOS_DESCARGABLES


# ─────────────────────────────────────────────────────────────────────────────
# Descarga de archivos via sesión autenticada
# ─────────────────────────────────────────────────────────────────────────────

async def download_file(page: Page, file_id: str, file_name: str, dest_dir: Path) -> Path | None:
    """
    Descarga un archivo de Drive via sesión Playwright autenticada.
    Intenta múltiples URLs de descarga.
    """
    dest_dir.mkdir(parents=True, exist_ok=True)

    # Limpiar nombre para usar como filename
    safe_name = re.sub(r'[<>:"/\\|?*]', '_', file_name).strip()[:150] or file_id

    # URL de descarga directa (funciona para archivos binarios como PDF, PPTX, etc.)
    download_urls = [
        f"https://drive.google.com/uc?export=download&id={file_id}",
        f"https://drive.google.com/uc?export=download&id={file_id}&confirm=t",
    ]

    async def _try_download(url: str, fallback_name: str) -> Path | None:
        """Navega a una URL de descarga y captura el archivo resultante."""
        try:
            async with page.expect_download(timeout=30000) as dl_info:
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=10000)
                except Exception as nav_err:
                    # "Download is starting" es esperado — el download YA se disparó
                    if "download" not in str(nav_err).lower():
                        raise
                    # Si hay confirmación de virus, hacer click en el link
                    await asyncio.sleep(1.5)
                    try:
                        confirm_btn = page.locator('#uc-download-link').first
                        if await confirm_btn.is_visible(timeout=2000):
                            await confirm_btn.click()
                    except Exception:
                        pass
            download = await dl_info.value
            suggested = download.suggested_filename or fallback_name
            # Evitar doble extensión (ej: "file.pdf.pdf")
            if suggested.endswith('.pdf.pdf'):
                suggested = suggested[:-4]
            dest = dest_dir / suggested
            await download.save_as(str(dest))
            return dest
        except Exception:
            return None

    def _print(msg: str):
        sys.stdout.buffer.write((msg + "\n").encode("utf-8", "replace"))
        sys.stdout.buffer.flush()

    # Intentar descarga directa (PDFs nativos, PPTX, DOCX, etc.)
    for dl_url in download_urls:
        dest = await _try_download(dl_url, safe_name)
        if dest and dest.exists() and dest.stat().st_size > 0:
            size_kb = dest.stat().st_size // 1024
            _print(f"     [DL] {dest.name} ({size_kb}KB)")
            return dest

    # Google Workspace files (Docs, Slides, Sheets): exportar a PDF
    workspace_exports = [
        f"https://docs.google.com/presentation/d/{file_id}/export/pdf",
        f"https://docs.google.com/document/d/{file_id}/export?format=pdf",
        f"https://docs.google.com/spreadsheets/d/{file_id}/export?format=pdf",
    ]
    for exp_url in workspace_exports:
        dest = await _try_download(exp_url, f"{safe_name}.pdf")
        if dest and dest.exists() and dest.stat().st_size > 0:
            # Evitar doble extensión
            if dest.name.endswith('.pdf.pdf'):
                new_dest = dest.parent / dest.name[:-4]
                dest.rename(new_dest)
                dest = new_dest
            size_kb = dest.stat().st_size // 1024
            _print(f"     [DL] {dest.name} ({size_kb}KB) [export PDF]")
            return dest

    _print(f"     [SKIP] {file_name[:60]} — no se pudo descargar")
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Supabase push
# ─────────────────────────────────────────────────────────────────────────────

def push_drive_files(alumno_nombre: str, files: list[dict]) -> bool:
    """Persiste metadatos de archivos Drive en classroom_materiales."""
    url = (os.getenv("SUPABASE_URL") or "").strip()
    key = (os.getenv("SUPABASE_SERVICE_KEY") or "").strip()
    if not url or not key:
        print("[WARN] Supabase no configurado, skip push")
        return False

    try:
        from supabase import create_client
        sb = create_client(url, key)

        # Borrar entradas previas de Drive compartido para este alumno
        sb.table("classroom_materiales").delete()\
            .eq("alumno", alumno_nombre)\
            .eq("curso", "Drive: Compartido conmigo")\
            .execute()

        if not files:
            return True

        # Tipos permitidos en la constraint de classroom_materiales
        TIPOS_VALIDOS = {'documento','presentacion','hoja','formulario','video','pdf','drive','sitio','archivo'}

        def tipo_safe(t):
            return t if t in TIPOS_VALIDOS else 'archivo'

        rows = [{
            "alumno":       alumno_nombre,
            "curso":        "Drive: Compartido conmigo",
            "tarea_titulo": clasificar_archivo(f),  # prueba/pauta/guia/material/temario
            "tarea_link":   "",
            "nombre":       f["name"][:300],
            "url":          f["url"][:500],
            "tipo":         tipo_safe(f["tipo"]),
        } for f in files]

        # Insertar en lotes de 200
        for i in range(0, len(rows), 200):
            sb.table("classroom_materiales").insert(rows[i:i+200]).execute()

        print(f"[OK] {alumno_nombre}: {len(rows)} archivos Drive guardados en Supabase")
        return True

    except Exception as e:
        print(f"[ERROR] Supabase push Drive: {e}")
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Pipeline principal
# ─────────────────────────────────────────────────────────────────────────────

async def extract_alumno_drive(alumno: dict, do_download: bool = False, debug: bool = False):
    """
    Extrae archivos de Drive "Compartido conmigo" para un alumno.
    Opcionalmente descarga los más relevantes (pruebas, guías, pautas).
    """
    print(f"\n{'='*60}")
    print(f"[Drive] {alumno['nombre']} ({alumno['email']})")
    print(f"{'='*60}")

    async with async_playwright() as pw:
        ctx = await get_context(pw, alumno)
        page = await ctx.new_page()

        try:
            files = await extract_shared_files(page, debug=debug)

            if not files:
                print("[WARN] No se encontraron archivos")
                return []

            # Guardar JSON de debug
            debug_path = OUTPUT_DIR / f"debug_drive_{alumno['slug']}.json"
            debug_path.write_text(
                json.dumps(files, ensure_ascii=False, indent=2, default=str),
                encoding="utf-8"
            )
            print(f"[DEBUG] Guardado en {debug_path}")

            # Mostrar los más relevantes (pruebas/pautas primero)
            prioridad = {"prueba": 0, "pauta": 1, "guia": 2, "temario": 3, "material": 4}
            files_sorted = sorted(files, key=lambda f: (prioridad.get(clasificar_archivo(f), 5), f["name"]))

            sys.stdout.buffer.write(b"\n[INFO] Archivos clasificados:\n")
            for f in files_sorted[:30]:  # mostrar primeros 30
                cat = clasificar_archivo(f)
                line = f"     [{cat.upper():<8}] [{f['tipo']:<12}] {f['name']}\n"
                sys.stdout.buffer.write(line.encode("utf-8", "replace"))
            if len(files_sorted) > 30:
                sys.stdout.buffer.write(f"     ... y {len(files_sorted) - 30} mas\n".encode("utf-8", "replace"))
            sys.stdout.buffer.flush()

            # Descargar archivos importantes
            if do_download:
                dest_dir = DOWNLOAD_DIR / alumno["slug"]
                descargables = [f for f in files_sorted if es_descargable(f)]
                # Priorizar: pruebas + pautas + guías (todos), materiales (max 20)
                to_download = [f for f in descargables if clasificar_archivo(f) in ("prueba", "pauta", "guia", "temario")]
                to_download += [f for f in descargables if clasificar_archivo(f) == "material"][:20]

                # Saltar archivos ya descargados (misma carpeta, mismo nombre base)
                dest_dir.mkdir(parents=True, exist_ok=True)
                existing_names = {p.stem.lower() for p in dest_dir.iterdir()}
                to_download_new = [
                    f for f in to_download
                    if re.sub(r'[<>:"/\\|?*]', '_', f["name"]).strip()[:150].rsplit('.', 1)[0].lower()
                    not in existing_names
                ]

                skipped = len(to_download) - len(to_download_new)
                print(f"\n[DOWNLOAD] {len(to_download_new)} archivos nuevos (saltando {skipped} ya descargados)...")
                downloaded = 0
                for f in to_download_new:
                    result = await download_file(page, f["id"], f["name"], dest_dir)
                    if result:
                        downloaded += 1
                print(f"[OK] {downloaded}/{len(to_download_new)} archivos nuevos descargados")

            # Persistir en Supabase
            push_drive_files(alumno["nombre"], files)

            return files

        finally:
            try:
                await ctx.close()
            except Exception:
                pass


async def main():
    do_download = "--download" in sys.argv
    debug = "--debug" in sys.argv

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
        sys.exit(1)

    for alumno in alumnos:
        await extract_alumno_drive(alumno, do_download=do_download, debug=debug)


if __name__ == "__main__":
    asyncio.run(main())
