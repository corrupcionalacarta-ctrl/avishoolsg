"""
AVI School - Orquestador
=========================
Corre los extractores en orden y dispara digest. Maneja errores granulares:
si Gmail falla, igual corre Classroom; si Classroom falla, igual manda digest.

Modos:
    python run_all.py --morning     # 6:30 AM: gmail + schoolnet + classroom + digest
    python run_all.py --evening     # 18:30 PM: gmail + digest (mas rapido)
    python run_all.py --gmail-only  # solo refresh gmail + digest

Logging:
    Todo va a run_all_<fecha>.log dentro de OUTPUT_DIR.
"""

import argparse
import asyncio
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "."))
PYTHON = sys.executable  # mismo Python del venv que ejecuto este script
HERE = Path(__file__).parent

LOG_FILE = OUTPUT_DIR / f"run_all_{datetime.now().strftime('%Y%m%d')}.log"


def log(msg: str, also_print: bool = True):
    line = f"[{datetime.now().isoformat(timespec='seconds')}] {msg}"
    if also_print:
        print(line)
    with LOG_FILE.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def run_step(name: str, cmd: list[str], timeout: int = 600, env: dict = None) -> bool:
    """Corre un comando, loguea, devuelve True si exit code 0."""
    log(f"=== STEP: {name} ===")
    log(f"CMD: {' '.join(cmd)}")
    try:
        result = subprocess.run(
            cmd,
            cwd=str(HERE),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            env=env,
        )
        if result.stdout:
            for line in result.stdout.splitlines():
                log(f"  | {line}", also_print=False)
        if result.stderr:
            for line in result.stderr.splitlines():
                log(f"  ! {line}", also_print=False)
        ok = result.returncode == 0
        log(f"=== {name}: {'OK' if ok else f'FAIL (exit {result.returncode})'} ===")
        return ok
    except subprocess.TimeoutExpired:
        log(f"=== {name}: TIMEOUT despues de {timeout}s ===")
        return False
    except Exception as e:
        log(f"=== {name}: EXCEPCION {e} ===")
        return False


def step_gmail(hours: int = 24) -> bool:
    return run_step(f"gmail --hours {hours}", [PYTHON, str(HERE / "gmail_extractor.py"), "--hours", str(hours)])


def step_classroom_pending(max_per_run: int = 5) -> bool:
    """Procesa hasta N clases pendientes. Si no hay state, primero lista."""
    state_file = OUTPUT_DIR / ".classroom_state.json"
    if not state_file.exists():
        log("[INFO] Sin state, listando clases primero...")
        ok = run_step("classroom --list-classes", [PYTHON, str(HERE / "schoolnet_extractor.py"), "--list-classes"], timeout=300)
        if not ok:
            return False
    return run_step(
        f"classroom --all-pending-classroom (max {max_per_run})",
        [PYTHON, str(HERE / "schoolnet_extractor.py"), "--all-pending-classroom", "--max-per-run", str(max_per_run)],
        timeout=1800,
    )


def step_schoolnet() -> bool:
    return run_step("schoolnet", [PYTHON, str(HERE / "schoolnet_extractor.py"), "--only", "schoolnet"], timeout=900)


def step_grades() -> bool:
    """Extrae notas y anotaciones de SchoolNet (1 vez al día, solo morning)."""
    return run_step("grades", [PYTHON, str(HERE / "schoolnet_direct.py")], timeout=600)


def step_ai_analysis() -> bool:
    return run_step("ai_analysis", [PYTHON, str(HERE / "ai_analysis.py")], timeout=120)


def step_digest(run_mode: str = "manual") -> bool:
    env = os.environ.copy()
    env["RUN_MODE"] = run_mode
    return run_step("digest", [PYTHON, str(HERE / "digest.py")], timeout=120, env=env)


def main():
    parser = argparse.ArgumentParser()
    g = parser.add_mutually_exclusive_group(required=True)
    g.add_argument("--morning", action="store_true", help="Pipeline matutino completo")
    g.add_argument("--evening", action="store_true", help="Pipeline vespertino (gmail + digest)")
    g.add_argument("--gmail-only", action="store_true", help="Solo refresh gmail + digest")
    args = parser.parse_args()

    log(f"\n{'='*60}\nINICIO RUN_ALL ({'morning' if args.morning else 'evening' if args.evening else 'gmail-only'})\n{'='*60}")

    results = {}

    if args.morning:
        results["gmail"] = step_gmail(hours=168)  # 7 días
        results["schoolnet"] = step_schoolnet()
        results["grades"] = step_grades()
        results["classroom"] = step_classroom_pending(max_per_run=5)
        results["ai_analysis"] = step_ai_analysis()
    elif args.evening:
        results["gmail"] = step_gmail(hours=168)  # 7 días
    elif args.gmail_only:
        results["gmail"] = step_gmail(hours=168)  # 7 días

    # Digest siempre, aunque algun extractor haya fallado
    run_mode = "morning" if args.morning else "evening" if args.evening else "manual"
    results["digest"] = step_digest(run_mode=run_mode)

    log(f"\n{'='*60}\nRESUMEN")
    for k, v in results.items():
        log(f"  {k:15s}: {'OK' if v else 'FAIL'}")
    log(f"{'='*60}\n")

    # Exit non-zero si digest fallo (lo unico critico)
    sys.exit(0 if results.get("digest", False) else 1)


if __name__ == "__main__":
    main()
