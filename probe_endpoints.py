"""
Prueba endpoints de SchoolNet para descubrir secciones disponibles.
Uso: python probe_endpoints.py
"""
import asyncio, json, os, re
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_URL = "https://schoolnet.colegium.com/webapp/es_CL"
BROWSER_DATA_DIR = Path(os.getenv("OUTPUT_DIR", ".")) / ".browser_session"

CANDIDATES = [
    "guias", "guia", "material", "materiales", "materialclase",
    "archivos", "archivo", "adjuntos", "adjunto",
    "documentos", "documento", "recursos", "recurso",
    "comunicaciones", "comunicacion", "mensajes", "mensaje",
    "informes", "informe", "reportes", "reporte",
    "programaciones", "programacion",
    "noticias", "noticia", "avisos", "aviso",
    "tareas", "tarea", "evaluaciones",
    "libretas", "libreta", "observaciones",
    "asistencia2", "boletin", "boletines",
    "fotos", "galeria",
]

async def probe():
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            user_data_dir=str(BROWSER_DATA_DIR),
            headless=True,
            args=["--no-sandbox"],
        )
        page = await ctx.new_page()
        page.set_default_timeout(15000)

        # Load angular context
        await page.goto(f"{BASE_URL}/index", wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(3000)

        print(f"[INFO] URL base: {page.url}")
        print(f"[INFO] Probando {len(CANDIDATES)} endpoints...\n")

        found = []

        for path in CANDIDATES:
            url = f"{BASE_URL}/{path}"
            try:
                result = await page.evaluate(f"""async () => {{
                    try {{
                        const r = await fetch('{url}', {{
                            method: 'GET',
                            headers: {{
                                'Accept': 'application/json, text/plain, */*',
                                'X-Requested-With': 'XMLHttpRequest'
                            }},
                            credentials: 'same-origin'
                        }});
                        const text = await r.text();
                        return {{ status: r.status, body: text.slice(0, 500) }};
                    }} catch(e) {{
                        return {{ status: 0, body: e.message }};
                    }}
                }}""")

                status = result.get("status", 0)
                body = result.get("body", "")

                # Check if it looks like useful JSON (not HTML, not 404/403)
                is_json = body.strip().startswith(("{", "["))
                is_html = "<html" in body.lower() or "<!doctype" in body.lower()
                is_empty = len(body.strip()) < 5

                if status == 200 and is_json:
                    print(f"  ✓ /{path}  [{status}]  {body[:150]}")
                    found.append({"path": path, "status": status, "body": body})
                elif status == 200 and not is_html and not is_empty:
                    print(f"  ? /{path}  [{status}]  {body[:150]}")
                elif status not in (404, 403, 302, 0):
                    print(f"  ~ /{path}  [{status}]")
                else:
                    print(f"  - /{path}  [{status}]")

            except Exception as e:
                print(f"  ! /{path}  ERROR: {e}")

        await ctx.close()

        print(f"\n[RESULTADO] Endpoints con JSON: {len(found)}")
        for f in found:
            print(f"  /{f['path']}")
            # Try to pretty-print
            try:
                data = json.loads(f["body"])
                if isinstance(data, list):
                    print(f"    Array de {len(data)} items")
                    if data:
                        print(f"    Keys del primer item: {list(data[0].keys()) if isinstance(data[0], dict) else type(data[0])}")
                elif isinstance(data, dict):
                    print(f"    Dict keys: {list(data.keys())[:10]}")
            except Exception:
                pass

asyncio.run(probe())
