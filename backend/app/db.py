from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.config import get_settings

_client: AsyncIOMotorClient | None = None


def get_db() -> AsyncIOMotorDatabase | None:
    if _client is None:
        return None
    return _client[get_settings().mongodb_db]


async def connect_db() -> None:
    global _client
    settings = get_settings()
    if not settings.mongodb_uri:
        return
    client = AsyncIOMotorClient(settings.mongodb_uri, serverSelectionTimeoutMS=8000)
    await client.admin.command("ping")
    _client = client
    db = get_db()
    await db.buildings.create_index([("location", "2dsphere")])
    await db.buildings.create_index("bin", unique=True)
    await db.analyses.create_index("bin", unique=True)


async def close_db() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None
