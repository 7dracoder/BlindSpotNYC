"""Local audio for persistent servers; Atlas GridFS for serverless instances."""

from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorGridFSBucket

from app.config import get_settings
from app.db import get_db


async def save(name: str, data: bytes) -> None:
    settings = get_settings()
    db = get_db()
    if settings.serverless and db is not None:
        await AsyncIOMotorGridFSBucket(db, bucket_name="audio").upload_from_stream(
            name, data, metadata={"content_type": "audio/mpeg"}
        )
        return
    target = Path(settings.audio_dir) / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)


async def exists(name: str) -> bool:
    db = get_db()
    if get_settings().serverless and db is not None:
        return await db["audio.files"].find_one({"filename": name}, {"_id": 1}) is not None
    return (Path(get_settings().audio_dir) / name).is_file()


async def read(name: str) -> bytes | None:
    db = get_db()
    if get_settings().serverless and db is not None:
        if not await exists(name):
            return None
        stream = await AsyncIOMotorGridFSBucket(db, bucket_name="audio").open_download_stream_by_name(name)
        try:
            return await stream.read()
        finally:
            await stream.close()
    target = Path(get_settings().audio_dir) / name
    return target.read_bytes() if target.is_file() else None
