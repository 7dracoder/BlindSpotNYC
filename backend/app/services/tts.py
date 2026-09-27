"""Audio briefing — ElevenLabs first, Grok TTS as fallback."""

from __future__ import annotations

from pathlib import Path

import httpx

from app.config import get_settings


async def _elevenlabs(key: str, voice_id: str, text: str) -> bytes:
    async with httpx.AsyncClient(timeout=60.0) as http:
        r = await http.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
            params={"output_format": "mp3_44100_128"},
            headers={"xi-api-key": key},
            json={"text": text, "model_id": "eleven_multilingual_v2"},
        )
        r.raise_for_status()
        return r.content


async def _grok(key: str, text: str) -> bytes:
    async with httpx.AsyncClient(timeout=60.0) as http:
        r = await http.post(
            "https://api.x.ai/v1/tts",
            headers={"Authorization": f"Bearer {key}"},
            json={"text": text, "voice_id": "eve", "language": "en"},
        )
        r.raise_for_status()
        return r.content


async def synthesize(text: str, name: str) -> tuple[str | None, str | None]:
    """Writes <audio_dir>/<name>.mp3. Returns (url, engine)."""
    s = get_settings()
    out = Path(s.audio_dir) / f"{name}.mp3"
    out.parent.mkdir(parents=True, exist_ok=True)

    attempts = []
    if s.elevenlabs_api_key:
        attempts.append(("elevenlabs", lambda: _elevenlabs(s.elevenlabs_api_key, s.elevenlabs_voice_id, text)))
    if s.xai_api_key:
        attempts.append(("grok", lambda: _grok(s.xai_api_key, text)))

    for engine, call in attempts:
        try:
            out.write_bytes(await call())
            return f"/api/audio/{name}.mp3", engine
        except httpx.HTTPError as exc:
            print(f"[tts] {engine} failed: {exc}")
    return None, None
