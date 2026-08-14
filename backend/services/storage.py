"""Private voice-message storage with local-development and Cloudinary backends."""
from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any

from fastapi import HTTPException, UploadFile

MAX_AUDIO_SIZE_BYTES = 10 * 1024 * 1024
ALLOWED_AUDIO_TYPES = {
    "audio/webm", "video/webm", "audio/mp4", "audio/ogg", "audio/wav",
    "audio/mpeg", "audio/aac", "audio/x-m4a", "audio/m4a",
}
ROOT_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = ROOT_DIR / "uploads" / "audio"


def _extension(content_type: str) -> str:
    if "mpeg" in content_type or "mp3" in content_type:
        return ".mp3"
    if "wav" in content_type:
        return ".wav"
    if "ogg" in content_type:
        return ".ogg"
    if "mp4" in content_type or "m4a" in content_type:
        return ".m4a"
    return ".webm"


async def _validated_content(file: UploadFile) -> tuple[bytes, str]:
    content_type = (file.content_type or "").lower().split(";", 1)[0].strip()
    if content_type not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported audio format. Use WebM, MP3, WAV, OGG, or M4A.")
    content = await file.read(MAX_AUDIO_SIZE_BYTES + 1)
    await file.close()
    if not content:
        raise HTTPException(status_code=400, detail="Audio file is empty.")
    if len(content) > MAX_AUDIO_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="Audio recording exceeds the 10 MB limit.")
    return content, content_type


class VoiceStorage:
    """Keeps Cloudinary-specific details out of chat routes."""

    def __init__(self) -> None:
        self.provider = os.getenv("MEDIA_STORAGE", "local").strip().lower()
        if self.provider == "local":
            UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    async def upload_voice_message(self, file: UploadFile) -> dict[str, Any]:
        content, content_type = await _validated_content(file)
        asset_id = f"voice_{uuid.uuid4().hex}"
        if self.provider == "cloudinary":
            try:
                import cloudinary
                import cloudinary.uploader
                cloudinary.config(
                    cloud_name=os.environ["CLOUDINARY_CLOUD_NAME"],
                    api_key=os.environ["CLOUDINARY_API_KEY"],
                    api_secret=os.environ["CLOUDINARY_API_SECRET"],
                    secure=True,
                )
                result = cloudinary.uploader.upload(
                    content, public_id=f"workforce/voice/{asset_id}", resource_type="video",
                    type="authenticated", overwrite=False,
                )
            except Exception as exc:
                raise HTTPException(status_code=502, detail="Voice storage is temporarily unavailable.") from exc
            return {
                "storage_provider": "cloudinary", "public_id": result["public_id"],
                "resource_type": result.get("resource_type", "video"),
                "mime_type": content_type, "size": len(content),
                "duration": float(result.get("duration") or 0),
            }

        filename = asset_id + _extension(content_type)
        (UPLOAD_DIR / filename).write_bytes(content)
        return {
            "storage_provider": "local", "public_id": filename, "resource_type": "video",
            "mime_type": content_type, "size": len(content), "duration": 0.0,
        }

    def get_voice_message_url(self, asset: dict[str, Any]) -> str | Path:
        if asset.get("storage_provider") == "cloudinary":
            import cloudinary
            import cloudinary.utils
            cloudinary.config(
                cloud_name=os.environ["CLOUDINARY_CLOUD_NAME"], api_key=os.environ["CLOUDINARY_API_KEY"],
                api_secret=os.environ["CLOUDINARY_API_SECRET"], secure=True,
            )
            return cloudinary.utils.cloudinary_url(
                asset["public_id"], resource_type=asset.get("resource_type", "video"),
                type="authenticated", sign_url=True, secure=True, expires_at=int(__import__("time").time()) + 300,
            )[0]
        safe_name = os.path.basename(str(asset.get("public_id", "")))
        path = UPLOAD_DIR / safe_name
        if not safe_name or not path.is_file():
            raise HTTPException(status_code=404, detail="Audio file not found.")
        return path

    async def delete_voice_message(self, asset: dict[str, Any]) -> None:
        if asset.get("storage_provider") == "cloudinary":
            import cloudinary.uploader
            cloudinary.uploader.destroy(asset["public_id"], resource_type=asset.get("resource_type", "video"), type="authenticated")
        else:
            path = UPLOAD_DIR / os.path.basename(str(asset.get("public_id", "")))
            if path.is_file():
                path.unlink()
