import os
import anthropic
from providers.base import BaseProvider


class AnthropicProvider(BaseProvider):
    def __init__(self):
        self.client = None

    def _get_client(self):
        if self.client is None:
            self.client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
        return self.client

    def complete(self, system_prompt, user_prompt, model):
        client = self._get_client()
        response = client.messages.create(
            model=model,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
            max_tokens=4096,
            temperature=0.7,
        )
        return response.content[0].text
