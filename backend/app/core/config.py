# pyrefly: ignore [missing-import]
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    MONGO_URI: str = "mongodb://127.0.0.1:27017"
    MONGO_DB_NAME: str = "ai_voice_crm"
    JWT_SECRET: str = "dev_secret_change_me"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24 hours for full operational shift
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    FRONTEND_ORIGIN: str = "http://localhost:5173"
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_PHONE_NUMBER: str = ""
    TWILIO_API_KEY: str = ""
    TWILIO_API_SECRET: str = ""
    TWILIO_TWIML_APP_SID: str = ""
    VAPI_API_KEY: str = ""
    VAPI_ASSISTANT_ID: str = ""
    VAPI_PHONE_NUMBER_ID: str = ""
    VAPI_BASE_URL: str = "https://api.vapi.ai"
    PLIVO_APP_ID: str = "42024221415255694"
    PLIVO_PHONE_NUMBER: str = "+918031826757"
    PLIVO_SIP_URI: str = "sip:42024221415255694@app.plivo.com"
    PLIVO_AUTH_ID: str = "MAZMI2Y2Y5NJATNWE1ZC"
    PLIVO_AUTH_TOKEN: str = "YmFiYmVjMGItMjQzNS00YWVjLTVkODctZTQzOWU3"
    BASE_URL: str = "https://fic-voice-crm.onrender.com"
    CLOUDINARY_CLOUD_NAME: str = "forge-crm"
    CLOUDINARY_API_KEY: str = ""
    CLOUDINARY_API_SECRET: str = ""
    CLOUDINARY_URL: str = ""
    CLOUDINARY_FOLDER: str = "fic_voice_recordings"

    class Config:
        env_file = ("backend/.env", ".env")
        extra = "ignore"


settings = Settings()

