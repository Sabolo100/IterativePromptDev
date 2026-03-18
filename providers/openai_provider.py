import os
from openai import OpenAI
from providers.base import BaseProvider


class OpenAIProvider(BaseProvider):
    def __init__(self):
        self.client = None

    def _get_client(self):
        if self.client is None:
            self.client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        return self.client

    # Models that use max_completion_tokens instead of max_tokens
    _NEW_TOKEN_PARAM_PREFIXES = ("o1", "o3", "o4", "gpt-5",)

    def _uses_new_token_param(self, model: str) -> bool:
        m = model.lower()
        return any(m.startswith(p) for p in self._NEW_TOKEN_PARAM_PREFIXES)

    def complete(self, system_prompt, user_prompt, model):
        client = self._get_client()
        extra = {}
        if self._uses_new_token_param(model):
            extra["max_completion_tokens"] = 4096
        else:
            extra["max_tokens"] = 4096

        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.7,
            **extra,
        )
        return response.choices[0].message.content
