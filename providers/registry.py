import os
from config import AVAILABLE_MODELS

_providers = {}


def _get_provider(provider_name):
    if provider_name not in _providers:
        if provider_name == "openai":
            from providers.openai_provider import OpenAIProvider
            _providers[provider_name] = OpenAIProvider()
        elif provider_name == "anthropic":
            from providers.anthropic_provider import AnthropicProvider
            _providers[provider_name] = AnthropicProvider()
        elif provider_name == "deepseek":
            from providers.deepseek_provider import DeepSeekProvider
            _providers[provider_name] = DeepSeekProvider()
        elif provider_name == "gemini":
            from providers.gemini_provider import GeminiProvider
            _providers[provider_name] = GeminiProvider()
        else:
            raise ValueError(f"Unknown provider: {provider_name}")
    return _providers[provider_name]


def call_model(provider_model_str, system_prompt, user_prompt):
    """Call an AI model. provider_model_str format: 'provider:model' e.g. 'openai:gpt-4.1'
    Returns (response_text, elapsed_ms)
    """
    provider_name, model = provider_model_str.split(":", 1)
    provider = _get_provider(provider_name)
    return provider.complete_with_retry(system_prompt, user_prompt, model)


def get_available_models():
    """Return dict of available providers with their models and API key status."""
    result = {}
    for key, info in AVAILABLE_MODELS.items():
        has_key = bool(os.environ.get(info["env_key"], "").strip()
                       and os.environ.get(info["env_key"]) != f"your-{key}-api-key-here")
        result[key] = {
            "name": info["name"],
            "models": info["models"],
            "configured": has_key,
        }
    return result
