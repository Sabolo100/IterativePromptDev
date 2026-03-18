import os
from openai import OpenAI
from providers.base import BaseProvider


class DeepSeekProvider(BaseProvider):
    def __init__(self):
        self.client = None

    def _get_client(self):
        if self.client is None:
            self.client = OpenAI(
                api_key=os.environ.get("DEEPSEEK_API_KEY"),
                base_url="https://api.deepseek.com"
            )
        return self.client

    def complete(self, system_prompt, user_prompt, model):
        client = self._get_client()
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.7,
            max_tokens=4096,
        )
        return response.choices[0].message.content
