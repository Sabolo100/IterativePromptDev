import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "iterativ.db")
PORT = 5000

AVAILABLE_MODELS = {
    "openai": {
        "name": "OpenAI",
        "models": ["gpt-5.4-mini","gpt-5.4","gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o"],
        "env_key": "OPENAI_API_KEY",
    },
    "anthropic": {
        "name": "Anthropic (Claude)",
        "models": ["claude-sonnet-4-20250514", "claude-haiku-4-5-20251001"],
        "env_key": "ANTHROPIC_API_KEY",
    },
    "deepseek": {
        "name": "DeepSeek",
        "models": ["deepseek-chat", "deepseek-reasoner"],
        "env_key": "DEEPSEEK_API_KEY",
    },
    "gemini": {
        "name": "Google Gemini",
        "models": ["gemini-2.5-pro", "gemini-2.5-flash"],
        "env_key": "GOOGLE_API_KEY",
    },
}

DEFAULT_GENERATOR_MODEL = "openai:gpt-4.1"
DEFAULT_EVALUATOR_MODEL = "openai:gpt-4.1-mini"
DEFAULT_REFINER_MODEL = "openai:gpt-4.1-mini"
DEFAULT_MAX_ITERATIONS = 5
