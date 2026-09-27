import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.routers.api import _analysis


class AudioCacheTests(unittest.IsolatedAsyncioTestCase):
    async def test_deployment_removes_stale_audio_url_but_keeps_briefing(self):
        cached = {"bin": "1000001", "briefing": "Cached briefing", "audio_url": "/api/audio/report.mp3", "audio_engine": "elevenlabs"}
        with tempfile.TemporaryDirectory() as directory:
            with patch("app.services.audio.get_settings", return_value=SimpleNamespace(audio_dir=directory, serverless=False)), patch(
                "app.routers.api.store.get_analysis", AsyncMock(return_value=cached)
            ):
                building = {"bin": "1000001", "fetched_at": "snapshot"}
                result = await _analysis(building)
                self.assertIsNone(result["audio_url"])
                self.assertIsNone(result["audio_engine"])
                self.assertEqual(result["briefing"], cached["briefing"])
                Path(directory, "report.mp3").write_bytes(b"audio")
                self.assertEqual((await _analysis(building))["audio_url"], cached["audio_url"])

    async def test_serverless_cached_audio_survives_without_a_local_file(self):
        cached = {"audio_url": "/api/audio/report.mp3", "audio_engine": "elevenlabs", "briefing": "Cached briefing"}
        with patch("app.routers.api.store.get_analysis", AsyncMock(return_value=cached)), patch(
            "app.routers.api.audio.exists", AsyncMock(return_value=True)
        ):
            result = await _analysis({"bin": "1000001", "fetched_at": "snapshot"})
            self.assertEqual(result["audio_url"], cached["audio_url"])
