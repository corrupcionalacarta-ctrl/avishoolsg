"""
Intercepta XHR/fetch reales del Angular SchoolNet para descubrir endpoints.
Navega a secciones específicas y captura qué APIs llama.
"""
import asyncio, json, os, re
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_URL = "https://schoolnet.colegium.com/webapp/es_CL"
BROWSER_DATA_DIR = Path(os.getenv("OUTPUT_DIR", ".")) / ".browser_session"
HEADLESS = False  # visible para debug

# Clicks de navegación a intentar (texto visible en el menú)
NAV_SECTIONS = [
    ("asistencia",     ["asistencia", "inasistencia", "attendance"]),
    ("materiales",     ["material", "guia", "recurso", "documento", "archivo", "programacion"]),
    ("comunicaciones", ["comunicacion", "mensaje", "aviso", "noticia", "comunicad"]),
]

captured: list[dict] = []

async def main():
    from playwright.async_api import async_playwright

    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            user_data_dir=str(BROWSER_DATA_DIR),
            headless=HEADLESS,
            args=["--no-sandbox"],
        )
        page = await ctx.new_page()
        page.set_default_timeout(20000)

        # Intercept all XHR/fetch requests to the SchoolNet API
        def on_request(req):
            url = req.url
            if "schoolnet.colegium.com/webapp/es_CL/" in url and req.resource_type in ("xhr", "fetch"):
                path = url.split("/webapp/es_CL/")[-1].split("?")[0]
                if path not in [c["path"] for c in captured]:
                    captured.append({"path": path, "method": req.method, "url": url})

        page.on("request", on_request)

        # Login/restore session
        print("[INFO] Cargando app...")
        await page.goto(f"{BASE_URL}/index", wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(3000)

        if "login" in page.url.lower():
            print("[ERROR] Sesión expirada. Corre primero schoolnet_direct.py para re-autenticar.")
            await ctx.close()
            return

        print(f"[OK] Sesión activa en: {page.url}")
        print()

        # Capture baseline requests
        baseline = [c["path"] for c in captured]

        # Now navigate to each section and capture new requests
        for section_name, keywords in NAV_SECTIONS:
            print(f"[INFO] Buscando sección: {section_name}...")
            before = set(c["path"] for c in captured)

            # Try direct navigation first
            await page.goto(f"{BASE_URL}/{section_name}", wait_until="domcontentloaded", timeout=15000)
            await page.wait_for_timeout(2000)

            # If that didn't work, try clicking nav links with matching text
            if "acceso restringido" not in (await page.content()).lower():
                after = set(c["path"] for c in captured)
                new = after - before
                if new:
                    print(f"  ✓ Nuevas APIs al navegar a /{section_name}: {new}")

            # Try clicking visible links that match keywords
            links = page.locator("a, button, li[role='menuitem'], .sn-nav__link")
            count = await links.count()
            for i in range(min(count, 50)):
                try:
                    link = links.nth(i)
                    text = (await link.inner_text()).strip().lower()
                    if any(kw in text for kw in keywords):
                        print(f"  → Click en: '{text[:60]}'")
                        before_click = set(c["path"] for c in captured)
                        await link.click(timeout=5000)
                        await page.wait_for_timeout(2000)
                        after_click = set(c["path"] for c in captured)
                        new_click = after_click - before_click
                        if new_click:
                            print(f"    APIs capturadas: {new_click}")
                except Exception:
                    pass

            # Go back to index
            await page.goto(f"{BASE_URL}/index", wait_until="domcontentloaded", timeout=15000)
            await page.wait_for_timeout(2000)
            print()

        # Final report
        print("\n" + "="*60)
        print("TODAS LAS APIS CAPTURADAS:")
        for c in sorted(captured, key=lambda x: x["path"]):
            print(f"  /{c['path']}")

        # Save full JSON from asistencia if found
        asist_paths = [c for c in captured if "asist" in c["path"].lower() or "inasist" in c["path"].lower()]
        if asist_paths:
            print(f"\nEndpoints de asistencia: {[c['path'] for c in asist_paths]}")
            for ap in asist_paths[:3]:
                await page.goto(f"{BASE_URL}/index", wait_until="domcontentloaded")
                await page.wait_for_timeout(2000)
                raw = await page.evaluate(f"""async () => {{
                    const r = await fetch('{ap['url']}', {{
                        headers: {{'X-Requested-With': 'XMLHttpRequest'}},
                        credentials: 'same-origin'
                    }});
                    return await r.text();
                }}""")
                fname = f"debug_asistencia_{ap['path'].replace('/','_')}.json"
                Path(fname).write_text(raw[:50000], encoding="utf-8")
                print(f"  Guardado: {fname} ({len(raw)} chars)")

        await ctx.close()


asyncio.run(main())
