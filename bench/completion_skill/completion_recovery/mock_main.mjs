/** Loopback DeepSeek Messages endpoint used only by keyless Pier preflight. */
import { createServer } from 'node:http'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const ready = process.argv[3]
const requests = process.argv[4]
const text = spec.text ?? 'I received the native supplement and will report the recorded facts.'
const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/anthropic/v1/messages') {
    response.writeHead(404).end()
    return
  }
  let raw = ''
  for await (const chunk of request) raw += chunk.toString()
  let body
  try { body = JSON.parse(raw) } catch { response.writeHead(400).end(); return }
  appendFileSync(requests, JSON.stringify({ body, path: request.url }) + '\n')
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const event of [
    { type: 'message_start', message: { id: 'msg_recovery_probe', model: 'deepseek-flash',
      usage: { input_tokens: 19, output_tokens: 0,
        cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 12 } },
    { type: 'message_stop' },
  ]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  response.end()
})
server.listen(0, '127.0.0.1', () => writeFileSync(ready,
  JSON.stringify({ port: server.address().port, pid: process.pid }) + '\n'))
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)))
