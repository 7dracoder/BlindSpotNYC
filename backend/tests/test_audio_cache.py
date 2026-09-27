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
            with patch("app.routers.api.get_settings", return_value=SimpleNamespace(audio_dir=directory)), patch(
                "app.routers.api.store.get_analysis", AsyncMock(return_value=cached)
            ):
                building = {"bin": "1000001", "fetched_at": "snapshot"}
                result = await _analysis(building)
                self.assertIsNone(result["audio_url"])
                self.assertIsNone(result["audio_engine"])
                self.assertEqual(result["briefing"], cached["briefing"])
                Path(directory, "report.mp3").write_bytes(b"audio")
                self.assertEqual((await _analysis(building))["audio_url"], cached["audio_url"])
