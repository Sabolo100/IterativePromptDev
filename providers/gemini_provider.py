import os
import google.generativeai as genai
from providers.base import BaseProvider


class GeminiProvider(BaseProvider):
    def __init__(self):
        self._configured = False

    def _ensure_configured(self):
        if not self._configured:
            genai.configure(api_key=os.environ.get("GOOGLE_API_KEY"))
            self._configured = True

    def complete(self, system_prompt, user_prompt, model):
        self._ensure_configured()
        gmodel = genai.GenerativeModel(
            model_name=model,
            system_instruction=system_prompt,
        )
        response = gmodel.generate_content(
            user_prompt,
            generation_config=genai.types.GenerationConfig(
                temperature=0.7,
                max_output_tokens=4096,
            ),
        )
        return response.text
