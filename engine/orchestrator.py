import json
import re
import logging
import queue
import threading
from db import repository as repo
from providers.registry import call_model
from engine.prompts import DOMAIN_DETECTOR_SYSTEM_PROMPT

logger = logging.getLogger(__name__)

# Active session event queues: session_id -> Queue
_event_queues = {}
_event_queues_lock = threading.Lock()


def get_event_queue(session_id):
    with _event_queues_lock:
        if session_id not in _event_queues:
            _event_queues[session_id] = queue.Queue()
        return _event_queues[session_id]


def remove_event_queue(session_id):
    with _event_queues_lock:
        _event_queues.pop(session_id, None)


def emit_event(session_id, event_type, data):
    q = get_event_queue(session_id)
    q.put({"type": event_type, "data": data})


def parse_json_response(raw_text):
    """Robustly extract a JSON object from a model response."""
    raw_text = raw_text.strip()
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        pass
    # Strip markdown fences
    match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', raw_text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
    # Find first {...} block
    match = re.search(r'\{.*\}', raw_text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            pass
    return None


def parse_evaluation(raw_text):
    """Extract JSON evaluation from model response, with fallbacks."""
    result = parse_json_response(raw_text)
    if result and "scores" in result:
        return result
    # Fallback
    return {
        "scores": {"clarity": 5, "relevance": 5, "persuasiveness": 5,
                    "structure": 5, "tone": 5, "completeness": 5},
        "overall": 5.0,
        "feedback": raw_text[:500] if raw_text else "Értékelés nem érhető el.",
        "strengths": [],
        "weaknesses": [],
        "suggestions": [],
    }


# ---------------------------------------------------------------------------
# DOMAIN DETECTION
# ---------------------------------------------------------------------------

def generate_evaluator_prompt(session_id):
    """Call the domain detector model to generate a session-specific evaluator prompt.
    Stores result in DB and emits SSE events. Returns True on success."""

    session = repo.get_session(session_id)
    if not session:
        return False

    # Already generated for this session
    if session.get("generated_evaluator_prompt"):
        return True

    emit_event(session_id, "domain_detecting", {
        "message": "Szakterület azonosítása és értékelő szakértő kiválasztása folyamatban..."
    })

    import time
    start = time.time()
    try:
        raw, detector_ms = call_model(
            session["evaluator_model"],
            DOMAIN_DETECTOR_SYSTEM_PROMPT,
            f"A user által megadott prompt:\n\n{session['user_prompt']}"
        )
    except Exception as e:
        logger.error(f"Domain detector failed for {session_id}: {e}")
        emit_event(session_id, "domain_detected", {
            "success": False,
            "message": f"Szakterület azonosítás sikertelen: {e}. Az alapértelmezett értékelő promptot használjuk.",
        })
        return False

    result = parse_json_response(raw)
    if not result or "evaluator_system_prompt" not in result:
        logger.warning(f"Domain detector returned invalid JSON for {session_id}: {raw[:200]}")
        emit_event(session_id, "domain_detected", {
            "success": False,
            "message": "Nem sikerült feldolgozni az értékelő promptot. Alapértelmezett értékelő használatban.",
        })
        return False

    # Persist to DB
    repo.update_session_domain(
        session_id,
        domain_detected=result.get("domain", "Általános"),
        domain_en=result.get("domain_en", "general"),
        expert_title=result.get("expert_title", "Senior Szakértő"),
        expert_description=result.get("expert_description", ""),
        evaluation_criteria=result.get("evaluation_criteria", []),
        generated_evaluator_prompt=result["evaluator_system_prompt"],
        domain_detector_ms=int((time.time() - start) * 1000),
    )

    emit_event(session_id, "domain_detected", {
        "success": True,
        "domain": result.get("domain", ""),
        "domain_en": result.get("domain_en", ""),
        "expert_title": result.get("expert_title", ""),
        "expert_description": result.get("expert_description", ""),
        "evaluation_criteria": result.get("evaluation_criteria", []),
        "evaluator_prompt_preview": result["evaluator_system_prompt"][:300] + "...",
        "detector_ms": int((time.time() - start) * 1000),
    })

    return True


# ---------------------------------------------------------------------------
# ITERATION RUNNER
# ---------------------------------------------------------------------------

def _get_active_evaluator_prompt(session):
    """Return the generated evaluator prompt if available, else fall back to default."""
    return (session.get("generated_evaluator_prompt")
            or session["evaluator_system_prompt"])


def run_iteration(session_id, iteration_num):
    """Run a single iteration of the optimization loop."""
    session = repo.get_session(session_id)
    if not session:
        raise ValueError(f"Session {session_id} not found")

    # Determine current prompt
    if iteration_num == 1:
        current_prompt = session["user_prompt"]
    else:
        last = repo.get_last_iteration(session_id)
        if last and last.get("refined_prompt"):
            current_prompt = last["refined_prompt"]
        else:
            current_prompt = session["user_prompt"]

    # Create iteration record
    iter_id = repo.create_iteration(session_id, iteration_num, current_prompt)

    # --- GENERATE ---
    repo.update_iteration(iter_id, status="generating")
    emit_event(session_id, "status_change", {
        "iteration_num": iteration_num, "status": "generating",
        "prompt_text": current_prompt
    })

    try:
        output_text, gen_ms = call_model(
            session["generator_model"],
            session["generator_system_prompt"],
            current_prompt
        )
    except Exception as e:
        logger.error(f"Generator failed: {e}")
        repo.update_iteration(iter_id, status="error", output_text=str(e))
        emit_event(session_id, "error", {"iteration_num": iteration_num, "message": str(e)})
        return None

    repo.update_iteration(iter_id, output_text=output_text, generator_ms=gen_ms, status="evaluating")
    emit_event(session_id, "status_change", {
        "iteration_num": iteration_num, "status": "evaluating",
        "output_text": output_text, "generator_ms": gen_ms
    })

    # --- EVALUATE (using generated expert prompt) ---
    active_eval_prompt = _get_active_evaluator_prompt(session)
    eval_user_prompt = f"""Értékeld az alábbi szöveget, amely a következő prompt alapján készült:

PROMPT:
{current_prompt}

GENERÁLT SZÖVEG:
{output_text}"""

    try:
        eval_raw, eval_ms = call_model(
            session["evaluator_model"],
            active_eval_prompt,
            eval_user_prompt
        )
    except Exception as e:
        logger.error(f"Evaluator failed: {e}")
        repo.update_iteration(iter_id, status="error")
        emit_event(session_id, "error", {"iteration_num": iteration_num, "message": str(e)})
        return None

    evaluation = parse_evaluation(eval_raw)
    overall_score = evaluation.get("overall", 5.0)

    # Attach expert context to evaluation for display
    if session.get("expert_title"):
        evaluation["_expert_title"] = session["expert_title"]
        evaluation["_domain"] = session.get("domain_detected", "")

    repo.update_iteration(iter_id,
                          evaluation_json=json.dumps(evaluation, ensure_ascii=False),
                          overall_score=overall_score,
                          evaluator_ms=eval_ms,
                          status="refining")
    emit_event(session_id, "status_change", {
        "iteration_num": iteration_num, "status": "refining",
        "evaluation": evaluation, "overall_score": overall_score, "evaluator_ms": eval_ms
    })

    # --- REFINE ---
    refine_user_prompt = f"""Az alábbi prompt, az abból generált szöveg és az értékelés alapján készíts egy javított promptot.

AKTUÁLIS PROMPT:
{current_prompt}

GENERÁLT SZÖVEG:
{output_text}

ÉRTÉKELÉS:
Összpontszám: {overall_score}/10
Visszajelzés: {evaluation.get('feedback', '')}
Gyengeségek: {', '.join(evaluation.get('weaknesses', []))}
Javaslatok: {', '.join(evaluation.get('suggestions', []))}"""

    try:
        refined_prompt, ref_ms = call_model(
            session["refiner_model"],
            session["refiner_system_prompt"],
            refine_user_prompt
        )
    except Exception as e:
        logger.error(f"Refiner failed: {e}")
        repo.update_iteration(iter_id, status="error")
        emit_event(session_id, "error", {"iteration_num": iteration_num, "message": str(e)})
        return None

    repo.update_iteration(iter_id,
                          refined_prompt=refined_prompt,
                          refiner_ms=ref_ms,
                          status="done")
    emit_event(session_id, "iteration_complete", {
        "iteration_num": iteration_num,
        "prompt_text": current_prompt,
        "output_text": output_text,
        "evaluation": evaluation,
        "overall_score": overall_score,
        "refined_prompt": refined_prompt,
        "generator_ms": gen_ms,
        "evaluator_ms": eval_ms,
        "refiner_ms": ref_ms,
    })

    return {
        "iteration_num": iteration_num,
        "overall_score": overall_score,
        "refined_prompt": refined_prompt,
    }


# ---------------------------------------------------------------------------
# LOOP RUNNER
# ---------------------------------------------------------------------------

def run_loop(session_id):
    """Run the full optimization loop in a background thread."""
    session = repo.get_session(session_id)
    if not session:
        return

    # Step 0: Generate domain-specific evaluator prompt
    repo.update_session_status(session_id, "detecting")
    generate_evaluator_prompt(session_id)
    repo.update_session_status(session_id, "running")

    max_iter = session["max_iterations"]

    # Find where we left off
    last = repo.get_last_iteration(session_id)
    start_num = (last["iteration_num"] + 1) if last else 1

    for i in range(start_num, max_iter + 1):
        # Check if session is still running (supports pause/stop)
        current = repo.get_session(session_id)
        if current["status"] not in ("running",):
            emit_event(session_id, "session_paused", {"iteration_num": i})
            return

        result = run_iteration(session_id, i)
        if result is None:
            repo.update_session_status(session_id, "stopped")
            emit_event(session_id, "session_complete", {
                "reason": "error", "total_iterations": i - 1
            })
            return

    # All iterations done
    repo.update_session_status(session_id, "done")
    iterations = repo.get_iterations(session_id)
    scores = [it.get("overall_score", 0) for it in iterations if it.get("overall_score")]
    emit_event(session_id, "session_complete", {
        "reason": "completed",
        "total_iterations": len(iterations),
        "final_score": scores[-1] if scores else 0,
        "score_improvement": (scores[-1] - scores[0]) if len(scores) >= 2 else 0,
    })


# ---------------------------------------------------------------------------
# PUBLIC API
# ---------------------------------------------------------------------------

_active_threads = {}


def start_session_loop(session_id):
    """Start the loop (including domain detection) in a background thread."""
    repo.update_session_status(session_id, "detecting")
    t = threading.Thread(target=run_loop, args=(session_id,), daemon=True)
    _active_threads[session_id] = t
    t.start()


def stop_session(session_id):
    repo.update_session_status(session_id, "stopped")


def pause_session(session_id):
    repo.update_session_status(session_id, "paused")


def resume_session(session_id):
    # When resuming, domain detection already done — go straight to running
    repo.update_session_status(session_id, "running")
    t = threading.Thread(target=_resume_loop, args=(session_id,), daemon=True)
    _active_threads[session_id] = t
    t.start()


def _resume_loop(session_id):
    """Resume loop without re-running domain detection."""
    session = repo.get_session(session_id)
    if not session:
        return

    max_iter = session["max_iterations"]
    last = repo.get_last_iteration(session_id)
    start_num = (last["iteration_num"] + 1) if last else 1

    for i in range(start_num, max_iter + 1):
        current = repo.get_session(session_id)
        if current["status"] not in ("running",):
            emit_event(session_id, "session_paused", {"iteration_num": i})
            return

        result = run_iteration(session_id, i)
        if result is None:
            repo.update_session_status(session_id, "stopped")
            emit_event(session_id, "session_complete", {"reason": "error", "total_iterations": i - 1})
            return

    repo.update_session_status(session_id, "done")
    iterations = repo.get_iterations(session_id)
    scores = [it.get("overall_score", 0) for it in iterations if it.get("overall_score")]
    emit_event(session_id, "session_complete", {
        "reason": "completed",
        "total_iterations": len(iterations),
        "final_score": scores[-1] if scores else 0,
        "score_improvement": (scores[-1] - scores[0]) if len(scores) >= 2 else 0,
    })
