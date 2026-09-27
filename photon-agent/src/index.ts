// BlindSpot iMessage agent: text an NYC address, get the hazard check back.
import 'dotenv/config'
import { Spectrum } from 'spectrum-ts'
import { imessage } from 'spectrum-ts/providers/imessage'
import { terminal } from 'spectrum-ts/providers/terminal'

const API = process.env.BLINDSPOT_API_URL ?? 'http://127.0.0.1:8000'

const HELP =
  'BlindSpot NYC checks a building for fire, structural, and flooding red flags.\n\n' +
  'Text me an address, e.g.\n3605 Sedgwick Ave, Bronx\n76 Saint Nicholas Pl, Manhattan'

async function lookup(address: string): Promise<string> {
  const res = await fetch(`${API}/api/sms/lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: address }),
  })
  if (!res.ok) return "BlindSpot can't reach NYC records right now. Try again in a minute."
  const data = (await res.json()) as { reply_text: string }
  return data.reply_text
}

// Reads SPECTRUM_PROJECT_ID / SPECTRUM_PROJECT_SECRET from the environment
const app = await Spectrum({ providers: [imessage.config(), terminal.config()] })
console.log('BlindSpot agent listening on iMessage + terminal')

for await (const [space, message] of app.messages) {
  if (message.direction !== 'inbound' || message.content.type !== 'text') continue
  const text = message.content.text.trim()

  if (!/\d/.test(text) || /^(hi|hey|hello|help|start)\b/i.test(text)) {
    await message.reply(HELP)
    continue
  }

  await space.responding(async () => {
    try {
      await message.reply(await lookup(text))
    } catch (err) {
      console.error(err)
      await message.reply('Something went wrong looking that up. Try another address.')
    }
  })
}
