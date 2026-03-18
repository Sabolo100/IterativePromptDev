import time
import logging

logger = logging.getLogger(__name__)


class BaseProvider:
    def complete(self, system_prompt, user_prompt, model):
        raise NotImplementedError

    def complete_with_retry(self, system_prompt, user_prompt, model, retries=3):
        for attempt in range(retries):
            try:
                start = time.time()
                result = self.complete(system_prompt, user_prompt, model)
                elapsed_ms = int((time.time() - start) * 1000)
                return result, elapsed_ms
            except Exception as e:
                logger.warning(f"Provider {self.__class__.__name__} attempt {attempt+1} failed: {e}")
                if attempt == retries - 1:
                    raise
                time.sleep(2 ** attempt)
        return "", 0
