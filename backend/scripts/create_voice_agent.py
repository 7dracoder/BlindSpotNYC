"""Create the BlindSpot voice inspector on ElevenLabs and print its agent id.

    uv run python scripts/create_voice_agent.py
    # then put ELEVENLABS_AGENT_ID=<id> in backend/.env
"""

import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings

PROMPT = """You are the BlindSpot NYC building inspector, talking out loud with someone deciding whether to rent at {{address}}.

Everything you know about the building is in this report, pulled today from NYC Open Data (DOB, HPD, 311, DOHMH) and local news:

{{building_report}}

How to talk:
- This is a spoken conversation. Answer in one to three short sentences, then stop. No lists, no markdown, no reading out IDs or codes.
- Only state facts from the report. If they ask something the report doesn't cover, say you don't have that record and suggest how to find out (ask the landlord, check HPD Online, visit at night, etc.).
- Be direct about danger. Fire and egress problems, long-running sidewalk sheds, vacate orders and repeated no-heat complaints matter most.
- Explain terms simply: an HPD class C violation is "immediately hazardous"; a sidewalk shed that stays up for years usually means facade repairs aren't getting done.
- If asked "should I rent here", give an honest read of the risks and the questions they should ask the landlord. Don't pretend to know things you don't.
- Records are reports and inspections, not proof of current conditions. Say so when it matters."""

FIRST_MESSAGE = (
    "Hi, I'm the BlindSpot inspector. I've pulled the city records for {{address}}, "
    "and it screens {{risk_label}} risk. What do you want to know about it?"
)


def main() -> None:
    s = get_settings()
    if not s.elevenlabs_api_key:
        sys.exit("Set ELEVENLABS_API_KEY in backend/.env first")
    r = httpx.post(
        "https://api.elevenlabs.io/v1/convai/agents/create",
        headers={"xi-api-key": s.elevenlabs_api_key},
        json={
            "name": "BlindSpot NYC inspector",
            "conversation_config": {
                "agent": {
                    "first_message": FIRST_MESSAGE,
                    "language": "en",
                    "prompt": {"prompt": PROMPT, "llm": "gemini-2.5-flash", "temperature": 0.3},
                    "dynamic_variables": {
                        "dynamic_variable_placeholders": {
                            "address": "225 West 86 Street, Manhattan",
                            "risk_label": "LOW",
                            "building_report": "No report loaded.",
                        }
                    },
                },
                "tts": {"voice_id": s.elevenlabs_voice_id},
            },
        },
        timeout=30,
    )
    if r.status_code >= 400:
        sys.exit(f"ElevenLabs said {r.status_code}: {r.text}")
    print(r.json()["agent_id"])


if __name__ == "__main__":
    main()
