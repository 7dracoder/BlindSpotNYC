import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createGoogleTileFetch } from '../src/lib/googleTiles.ts'

test('Google tile URLs preserve sessions and credentials in dev and production', async () => {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: input instanceof Request ? input.url : String(input), headers: new Headers(init?.headers) })
    return new Response('{}')
  }
  try {
    const dev = createGoogleTileFetch('test-key', 'http://127.0.0.1:5173')
    for (const uri of [
      '/v1/3dtiles/datasets/test/files/tile.glb?session=abc',
      'https://tile.googleapis.com/v1/3dtiles/datasets/test/files/tile.glb?session=abc',
      'http://127.0.0.1:5173/v1/3dtiles/datasets/test/files/tile.glb?session=abc',
      'datasets/test/files/tile.glb?session=abc',
    ]) await dev(uri)
    assert.ok(calls.every((call) => call.url === 'http://127.0.0.1:5173/v1/3dtiles/datasets/test/files/tile.glb?session=abc'))
    assert.ok(calls.every((call) => call.headers.get('X-GOOG-API-KEY') === 'test-key'))
    const production = createGoogleTileFetch('test-key')
    await production('/v1/3dtiles/root.json')
    assert.equal(calls.at(-1).url, 'https://tile.googleapis.com/v1/3dtiles/root.json')
    await production(new Request('https://tile.googleapis.com/v1/3dtiles/root.json', { headers: { 'X-Test': 'kept' } }))
    assert.equal(calls.at(-1).headers.get('X-Test'), 'kept')
    await production('https://example.com/image.png')
    assert.equal(calls.at(-1).url, 'https://example.com/image.png')
    assert.equal(calls.at(-1).headers.get('X-GOOG-API-KEY'), null)
  } finally {
    globalThis.fetch = original
  }
})

test('authentication failures trigger a fallback and reject the tile request', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response('', { status: 403 })
  const reasons = []
  try {
    const load = createGoogleTileFetch('test-key', undefined, (reason) => reasons.push(reason))
    await assert.rejects(load('/v1/3dtiles/datasets/test/tile.glb'), /403/)
    assert.deepEqual(reasons, ['Google Maps access was denied.'])
  } finally {
    globalThis.fetch = original
  }
})
