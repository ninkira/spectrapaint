from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    FRONTEND_ORIGIN: str = "http://localhost:5173"

settings = Settings()
