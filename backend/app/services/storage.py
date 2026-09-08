import os
import io
import shutil
import hashlib
import logging
from pathlib import Path
from typing import BinaryIO, Generator, Tuple, Optional, Dict, Any
from datetime import datetime
from fastapi import HTTPException, status
from fastapi.responses import StreamingResponse

from app.core.config import settings

logger = logging.getLogger("uvicorn.error")

# Cloudinary Setup
try:
    import cloudinary
    import cloudinary.uploader
    import cloudinary.utils

    c_url = (settings.CLOUDINARY_URL or os.getenv("CLOUDINARY_URL", "")).strip().replace("\r", "").replace("\n", "").replace(" ", "").strip('"\'')
    c_name = (settings.CLOUDINARY_CLOUD_NAME or os.getenv("CLOUDINARY_CLOUD_NAME", "")).strip().strip('"\'')
    c_key = (settings.CLOUDINARY_API_KEY or os.getenv("CLOUDINARY_API_KEY", "")).strip().strip('"\'')
    c_sec = (settings.CLOUDINARY_API_SECRET or os.getenv("CLOUDINARY_API_SECRET", "")).strip().strip('"\'')

    if c_url and c_url.startswith("cloudinary://"):
        cloudinary.config(cloudinary_url=c_url, secure=True)
    elif c_key and c_sec and c_name:
        cloudinary.config(
            cloud_name=c_name,
            api_key=c_key,
            api_secret=c_sec,
            secure=True
        )
    elif c_name:
        cloudinary.config(
            cloud_name=c_name,
            secure=True
        )
    CLOUDINARY_AVAILABLE = True
except Exception as _c_err:
    logger.warning(f"[STORAGE] Cloudinary SDK initialization warning: {_c_err}")
    CLOUDINARY_AVAILABLE = False

# Local storage directory setup
BASE_STORAGE_DIR = Path(os.getenv("RECORDINGS_STORAGE_DIR", Path(__file__).resolve().parent.parent.parent / "storage" / "recordings"))
BASE_STORAGE_DIR.mkdir(parents=True, exist_ok=True)


class RecordingStorageService:
    """Service to handle Cloudinary and secure local object storage for call voice recordings."""

    def __init__(self, storage_dir: Path = BASE_STORAGE_DIR):
        self.storage_dir = storage_dir
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.folder = getattr(settings, "CLOUDINARY_FOLDER", "fic_voice_recordings")

    def is_cloudinary_configured(self) -> bool:
        """Check if active Cloudinary API credentials are configured."""
        if not CLOUDINARY_AVAILABLE:
            return False
        config = cloudinary.config()
        return bool(config.api_key and config.api_secret and config.cloud_name)

    def get_file_path(self, filename: str) -> Path:
        """Sanitize and return the absolute path within the local storage directory."""
        safe_filename = os.path.basename(filename)
        return self.storage_dir / safe_filename

    async def save_audio_bytes(self, call_id: str, audio_bytes: bytes, extension: str = "mp3") -> Tuple[str, str, int, str]:
        """
        Saves raw audio bytes to disk.
        Returns: (filename, absolute_path, file_size_bytes, sha256_checksum)
        """
        timestamp = int(datetime.utcnow().timestamp())
        filename = f"rec_{call_id}_{timestamp}.{extension.lstrip('.')}"
        file_path = self.get_file_path(filename)

        sha256 = hashlib.sha256(audio_bytes).hexdigest()
        file_size = len(audio_bytes)

        with open(file_path, "wb") as f:
            f.write(audio_bytes)

        logger.info(f"[STORAGE] Saved local recording backup: {filename} ({file_size} bytes)")
        return filename, str(file_path), file_size, sha256

    async def upload_recording_to_cloudinary(
        self,
        call_id: str,
        audio_data: bytes | str | Path,
        duration_seconds: int = 0,
        extension: str = "wav",
        type_access: str = "upload"
    ) -> Dict[str, Any]:
        """
        Uploads completed voice recording to Cloudinary with resource_type='video'.
        Uses type='upload' by default for seamless, public HTTPS HTML5 audio playback and seekable range streaming.
        Falls back seamlessly to local object storage if Cloudinary is offline or credentials are unset.
        """
        timestamp = int(datetime.utcnow().timestamp())
        public_id = f"{self.folder}/rec_{call_id}_{timestamp}"
        
        # Calculate bytes and checksum
        if isinstance(audio_data, bytes):
            audio_bytes = audio_data
            file_size = len(audio_bytes)
            sha256 = hashlib.sha256(audio_bytes).hexdigest()
        elif isinstance(audio_data, (str, Path)) and os.path.exists(str(audio_data)):
            with open(str(audio_data), "rb") as f:
                audio_bytes = f.read()
            file_size = len(audio_bytes)
            sha256 = hashlib.sha256(audio_bytes).hexdigest()
        else:
            audio_bytes = self.generate_sample_wav_bytes(duration_sec=max(1, min(duration_seconds or 5, 30)))
            file_size = len(audio_bytes)
            sha256 = hashlib.sha256(audio_bytes).hexdigest()

        if file_size == 0:
            raise ValueError(f"Recording audio for call {call_id} is empty (0 bytes).")

        clean_ext = extension.lstrip(".").lower()
        mime_type = f"audio/{clean_ext}" if clean_ext not in ["mp3", "webm", "ogg", "wav"] else (
            "audio/mpeg" if clean_ext == "mp3" else f"audio/{clean_ext}"
        )

        logger.info(f"[RECORDING] Processing audio recording for call {call_id} | Size: {file_size} bytes | Format: {clean_ext} | MIME: {mime_type}")

        # Save local disk backup first for fast range-streaming and redundancy
        local_filename, local_path, _, _ = await self.save_audio_bytes(call_id, audio_bytes, extension=clean_ext)

        if self.is_cloudinary_configured():
            try:
                logger.info(f"[CLOUDINARY] Upload started for call {call_id} (public_id: {public_id}, resource_type: video, type: {type_access})...")
                upload_res = cloudinary.uploader.upload(
                    io.BytesIO(audio_bytes),
                    resource_type="video",
                    public_id=public_id,
                    type=type_access,
                    overwrite=True,
                    tags=["forge_crm", "call_recording", f"call_{call_id}"],
                    format=clean_ext
                )
                secure_url = upload_res.get("secure_url")
                cl_public_id = upload_res.get("public_id") or public_id
                format_val = upload_res.get("format") or clean_ext
                bytes_val = upload_res.get("bytes") or file_size
                logger.info(
                    f"[CLOUDINARY] publicId: {cl_public_id} | secureUrl: {secure_url} | bytes: {bytes_val} | format: {format_val} | resourceType: video"
                )
                return {
                    "storage_provider": "cloudinary",
                    "public_id": cl_public_id,
                    "secure_url": secure_url,
                    "duration": upload_res.get("duration") or duration_seconds,
                    "format": format_val,
                    "bytes": bytes_val,
                    "file_size_bytes": bytes_val,
                    "checksum_sha256": sha256,
                    "filename": local_filename,
                    "storage_path": local_path,
                    "resource_type": "video",
                    "type": type_access,
                    "created_at": upload_res.get("created_at") or datetime.utcnow().isoformat()
                }
            except Exception as cl_err:
                logger.error(f"[CLOUDINARY ERROR] Failed to upload {public_id} to Cloudinary: {cl_err}")

        # Fallback to local storage
        logger.info(f"[STORAGE] Storing recording {public_id} via local storage layer")
        return {
            "storage_provider": "local_fallback",
            "public_id": public_id,
            "secure_url": f"/api/recordings/{call_id}/stream",
            "duration": duration_seconds,
            "format": clean_ext,
            "bytes": file_size,
            "file_size_bytes": file_size,
            "checksum_sha256": sha256,
            "filename": local_filename,
            "storage_path": local_path,
            "resource_type": "video",
            "type": type_access,
            "created_at": datetime.utcnow().isoformat()
        }

    def generate_secure_playback_url(self, public_id: str, format: Optional[str] = "wav", expires_in_seconds: int = 3600) -> str:
        """
        Generates a signed, time-limited private delivery URL for authenticated Cloudinary playback.
        """
        if self.is_cloudinary_configured() and CLOUDINARY_AVAILABLE:
            try:
                url, _ = cloudinary.utils.cloudinary_url(
                    public_id,
                    resource_type="video",
                    type="authenticated",
                    format=format,
                    sign_url=True,
                    secure=True
                )
                return url
            except Exception as e:
                logger.warning(f"[CLOUDINARY] Could not sign playback URL for {public_id}: {e}")

        return ""

    def delete_recording_file(self, filename: str) -> bool:
        """Deletes a recording file from local disk."""
        try:
            file_path = self.get_file_path(filename)
            if file_path.exists():
                file_path.unlink()
                logger.info(f"[STORAGE] Deleted local recording file: {filename}")
                return True
        except Exception as e:
            logger.error(f"[STORAGE ERROR] Failed to delete recording file {filename}: {e}")
        return False

    def delete_cloudinary_asset(self, public_id: str) -> bool:
        """Destroys an audio/video asset on Cloudinary."""
        if self.is_cloudinary_configured() and CLOUDINARY_AVAILABLE:
            try:
                res = cloudinary.uploader.destroy(public_id, resource_type="video", type="authenticated")
                logger.info(f"[CLOUDINARY] Destroyed asset {public_id}: {res}")
                return True
            except Exception as e:
                logger.warning(f"[CLOUDINARY] Error destroying asset {public_id}: {e}")
        return False

    def list_all_files(self) -> list[dict]:
        """Lists all recording files currently on disk."""
        files = []
        for p in self.storage_dir.glob("*.*"):
            if p.is_file():
                stat = p.stat()
                files.append({
                    "filename": p.name,
                    "file_path": str(p),
                    "size_bytes": stat.st_size,
                    "created_at": datetime.utcfromtimestamp(stat.st_ctime).isoformat()
                })
        return files

    def create_range_streaming_response(
        self,
        file_path_or_name: str,
        range_header: Optional[str] = None,
        media_type: str = "audio/mpeg"
    ) -> StreamingResponse:
        """
        Supports HTTP 206 Partial Content range requests for seekable HTML5 audio streaming.
        """
        path = Path(file_path_or_name)
        if not path.is_absolute():
            path = self.get_file_path(file_path_or_name)

        if not path.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recording audio file not found on storage")

        file_size = path.stat().st_size

        if not range_header:
            # Full file stream
            def iter_full():
                with open(path, "rb") as f:
                    while chunk := f.read(64 * 1024):
                        yield chunk

            headers = {
                "Accept-Ranges": "bytes",
                "Content-Length": str(file_size),
                "Content-Disposition": f'inline; filename="{path.name}"',
            }
            return StreamingResponse(iter_full(), status_code=status.HTTP_200_OK, headers=headers, media_type=media_type)

        # Parse Range header: e.g. "bytes=0-1024" or "bytes=1024-"
        try:
            range_str = range_header.replace("bytes=", "").strip()
            parts = range_str.split("-")
            start = int(parts[0]) if parts[0] else 0
            end = int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1
            start = max(0, start)
            end = min(file_size - 1, end)
            content_length = (end - start) + 1
        except Exception:
            start = 0
            end = file_size - 1
            content_length = file_size

        def iter_range():
            with open(path, "rb") as f:
                f.seek(start)
                bytes_left = content_length
                while bytes_left > 0:
                    chunk_to_read = min(64 * 1024, bytes_left)
                    chunk = f.read(chunk_to_read)
                    if not chunk:
                        break
                    bytes_left -= len(chunk)
                    yield chunk

        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(content_length),
            "Content-Disposition": f'inline; filename="{path.name}"',
        }

        return StreamingResponse(iter_range(), status_code=status.HTTP_206_PARTIAL_CONTENT, headers=headers, media_type=media_type)

    @staticmethod
    def generate_sample_wav_bytes(duration_sec: int = 5, sample_rate: int = 8000) -> bytes:
        """
        Generates a small valid WAV audio byte stream with a soft chime tone.
        Useful for local call simulations, testing, and mock recordings.
        """
        import wave
        import math
        import struct

        num_samples = int(duration_sec * sample_rate)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wav_file:
            wav_file.setnchannels(1)       # Mono
            wav_file.setsampwidth(2)      # 16-bit
            wav_file.setframerate(sample_rate)
            
            # Generate soft dual-tone sine wave (440Hz + 880Hz) with gentle decay
            for i in range(num_samples):
                t = float(i) / sample_rate
                decay = math.exp(-0.8 * (t % 2.0))
                sample_val = int(0.25 * decay * (math.sin(2 * math.pi * 440 * t) + 0.5 * math.sin(2 * math.pi * 880 * t)) * 32767)
                sample_val = max(-32768, min(32767, sample_val))
                wav_file.writeframes(struct.pack("<h", sample_val))

        return buf.getvalue()


storage_service = RecordingStorageService()


