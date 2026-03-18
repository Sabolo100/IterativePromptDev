import json
from flask import Blueprint, request, jsonify
from db import repository as repo
from engine import orchestrator
from engine.prompts import (DEFAULT_GENERATOR_SYSTEM_PROMPT,
                            DEFAULT_EVALUATOR_SYSTEM_PROMPT,
                            DEFAULT_REFINER_SYSTEM_PROMPT)
from providers.registry import get_available_models
from config import DEFAULT_GENERATOR_MODEL, DEFAULT_EVALUATOR_MODEL, DEFAULT_REFINER_MODEL, DEFAULT_MAX_ITERATIONS

api_bp = Blueprint("api", __name__)


@api_bp.route("/sessions", methods=["POST"])
def create_session():
    data = request.json or {}

    # If preset specified, load its prompts
    preset = None
    if data.get("preset_id"):
        preset = repo.get_preset(data["preset_id"])

    session_id = repo.create_session(
        preset_name=data.get("preset_id", "custom"),
        mode=data.get("mode", "auto"),
        generator_model=data.get("generator_model", DEFAULT_GENERATOR_MODEL),
        evaluator_model=data.get("evaluator_model", DEFAULT_EVALUATOR_MODEL),
        refiner_model=data.get("refiner_model", DEFAULT_REFINER_MODEL),
        generator_system_prompt=data.get("generator_system_prompt",
                                         (preset or {}).get("generator_system_prompt") or DEFAULT_GENERATOR_SYSTEM_PROMPT),
        evaluator_system_prompt=data.get("evaluator_system_prompt",
                                         (preset or {}).get("evaluator_system_prompt") or DEFAULT_EVALUATOR_SYSTEM_PROMPT),
        refiner_system_prompt=data.get("refiner_system_prompt",
                                       (preset or {}).get("refiner_system_prompt") or DEFAULT_REFINER_SYSTEM_PROMPT),
        user_prompt=data.get("user_prompt", (preset or {}).get("user_prompt", "")),
        max_iterations=data.get("max_iterations", DEFAULT_MAX_ITERATIONS),
    )

    return jsonify({"session_id": session_id}), 201


@api_bp.route("/sessions", methods=["GET"])
def list_sessions():
    return jsonify(repo.list_sessions())


@api_bp.route("/sessions/<session_id>", methods=["GET"])
def get_session(session_id):
    session = repo.get_session(session_id)
    if not session:
        return jsonify({"error": "Session not found"}), 404
    session["iterations"] = repo.get_iterations(session_id)
    return jsonify(session)


@api_bp.route("/sessions/<session_id>/start", methods=["POST"])
def start_session(session_id):
    session = repo.get_session(session_id)
    if not session:
        return jsonify({"error": "Session not found"}), 404
    orchestrator.start_session_loop(session_id)
    return jsonify({"status": "running"})


@api_bp.route("/sessions/<session_id>/pause", methods=["POST"])
def pause_session(session_id):
    orchestrator.pause_session(session_id)
    return jsonify({"status": "paused"})


@api_bp.route("/sessions/<session_id>/resume", methods=["POST"])
def resume_session(session_id):
    orchestrator.resume_session(session_id)
    return jsonify({"status": "running"})


@api_bp.route("/sessions/<session_id>/stop", methods=["POST"])
def stop_session(session_id):
    orchestrator.stop_session(session_id)
    return jsonify({"status": "stopped"})


@api_bp.route("/sessions/<session_id>/step", methods=["POST"])
def step_session(session_id):
    session = repo.get_session(session_id)
    if not session:
        return jsonify({"error": "Session not found"}), 404

    last = repo.get_last_iteration(session_id)
    next_num = (last["iteration_num"] + 1) if last else 1

    if next_num > session["max_iterations"]:
        return jsonify({"error": "Max iterations reached"}), 400

    repo.update_session_status(session_id, "running")

    import threading
    def do_step():
        orchestrator.run_iteration(session_id, next_num)
        if next_num >= session["max_iterations"]:
            repo.update_session_status(session_id, "done")
            orchestrator.emit_event(session_id, "session_complete", {
                "reason": "completed", "total_iterations": next_num
            })
        else:
            repo.update_session_status(session_id, "paused")

    t = threading.Thread(target=do_step, daemon=True)
    t.start()

    return jsonify({"status": "stepping", "iteration_num": next_num})


@api_bp.route("/sessions/<session_id>/export", methods=["GET"])
def export_session(session_id):
    session = repo.get_session(session_id)
    if not session:
        return jsonify({"error": "Session not found"}), 404
    session["iterations"] = repo.get_iterations(session_id)
    return jsonify(session), 200, {
        "Content-Disposition": f"attachment; filename=session_{session_id}.json"
    }


@api_bp.route("/sessions/<session_id>", methods=["DELETE"])
def delete_session(session_id):
    repo.delete_session(session_id)
    return jsonify({"status": "deleted"})


@api_bp.route("/presets", methods=["GET"])
def list_presets():
    return jsonify(repo.list_presets())


@api_bp.route("/models", methods=["GET"])
def list_models():
    return jsonify(get_available_models())


@api_bp.route("/config/prompts", methods=["GET"])
def get_prompts():
    return jsonify({
        "generator": repo.get_config("generator_system_prompt", DEFAULT_GENERATOR_SYSTEM_PROMPT),
        "evaluator": repo.get_config("evaluator_system_prompt", DEFAULT_EVALUATOR_SYSTEM_PROMPT),
        "refiner": repo.get_config("refiner_system_prompt", DEFAULT_REFINER_SYSTEM_PROMPT),
    })


@api_bp.route("/config/prompts", methods=["POST"])
def save_prompts():
    data = request.json or {}
    if "generator" in data:
        repo.set_config("generator_system_prompt", data["generator"])
    if "evaluator" in data:
        repo.set_config("evaluator_system_prompt", data["evaluator"])
    if "refiner" in data:
        repo.set_config("refiner_system_prompt", data["refiner"])
    return jsonify({"status": "saved"})


@api_bp.route("/sessions/<session_id>/evaluator-prompt", methods=["GET"])
def get_session_evaluator_prompt(session_id):
    """Return the dynamically generated evaluator prompt and domain info for a session."""
    session = repo.get_session(session_id)
    if not session:
        return jsonify({"error": "Session not found"}), 404
    import json as _json
    criteria = session.get("evaluation_criteria")
    if criteria and isinstance(criteria, str):
        try:
            criteria = _json.loads(criteria)
        except Exception:
            criteria = []
    return jsonify({
        "session_id": session_id,
        "domain_detected": session.get("domain_detected"),
        "domain_en": session.get("domain_en"),
        "expert_title": session.get("expert_title"),
        "expert_description": session.get("expert_description"),
        "evaluation_criteria": criteria or [],
        "generated_evaluator_prompt": session.get("generated_evaluator_prompt"),
        "domain_detector_ms": session.get("domain_detector_ms", 0),
    })


@api_bp.route("/sessions/<session_id>/export/docx", methods=["GET"])
def export_session_docx(session_id):
    """Generate and return a Word (.docx) session report."""
    from flask import Response
    session = repo.get_session(session_id)
    if not session:
        return jsonify({"error": "Session not found"}), 404
    iterations = repo.get_iterations(session_id)
    try:
        from engine.export_docx import generate_session_docx
        docx_bytes = generate_session_docx(dict(session), iterations)
    except Exception as e:
        return jsonify({"error": f"DOCX generation failed: {e}"}), 500

    return Response(
        docx_bytes,
        mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f"attachment; filename=session_{session_id}.docx"}
    )
