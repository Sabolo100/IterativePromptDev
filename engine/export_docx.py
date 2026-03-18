"""
export_docx.py — Generate a Word (.docx) session report.

Usage:
    from engine.export_docx import generate_session_docx
    docx_bytes = generate_session_docx(session_dict, iterations_list)
"""
import json
import subprocess
import os

_JS_SCRIPT = os.path.join(os.path.dirname(__file__), "generate_docx.js")


def generate_session_docx(session: dict, iterations: list) -> bytes:
    """Serialize session data to JSON, call generate_docx.js via Node.js,
    and return the resulting DOCX binary."""

    payload = json.dumps({"session": session, "iterations": iterations},
                         ensure_ascii=False, default=str)

    result = subprocess.run(
        ["node", _JS_SCRIPT],
        input=payload.encode("utf-8"),
        capture_output=True,
        timeout=60,
    )

    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace")
        raise RuntimeError(f"DOCX generation failed:\n{stderr}")

    return result.stdout
