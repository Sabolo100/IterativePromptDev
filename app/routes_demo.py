import json
import queue
from flask import Blueprint, render_template, Response
from engine.orchestrator import get_event_queue

demo_bp = Blueprint("demo", __name__)


@demo_bp.route("/")
def index():
    return render_template("demo.html")


@demo_bp.route("/stream/<session_id>")
def stream(session_id):
    def generate():
        q = get_event_queue(session_id)
        while True:
            try:
                event = q.get(timeout=30)
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                if event.get("type") in ("session_complete", "session_stopped"):
                    break
            except queue.Empty:
                # Send keepalive
                yield ": keepalive\n\n"

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
