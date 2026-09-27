from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    mongodb_uri: str = ""
    mongodb_db: str = "blindspot"
    tiger_database_url: str = ""
    gemini_api_key: str = ""
    gemini_model: str = "gemini-flash-latest"
    xai_api_key: str = ""
    xai_model: str = "grok-4.7"
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id: str = "JBFqnCBsd6RMkjVDRZzb"
    elevenlabs_agent_id: str = ""
    tavily_api_key: str = ""
    public_app_url: str = "http://127.0.0.1:5173"
    public_api_url: str = "http://127.0.0.1:8000"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    audio_dir: str = "data/audio"
    frontend_dist: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
