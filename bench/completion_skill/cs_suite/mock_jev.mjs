/** Loopback-only, dynamic-port Jev fixture for native keyless Pier probes. */
import { createServer } from 'node:http'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const readyPath = process.argv[3]
const evidencePath = process.argv[4]
const server = createServer(async (request, response) => {
  if (request.method !== 'POST' || request.url !== '/v1/systemone') {
    response.writeHead(404).end()
    return
  }
  let raw = ''
  for await (const chunk of request) raw += chunk.toString()
  let input
  try { input = JSON.parse(raw) } catch {
    response.writeHead(400).end()
    return
  }
  appendFileSync(evidencePath, JSON.stringify({ model: input.model, questions: input.questions }) + '\n')
  const answers = {}
  for (const [id, question] of Object.entries(input.questions ?? {})) {
    if (question.type === 'choice') {
      const options = Object.keys(question.criteria ?? {})
      const desired = spec.choiceByQuestionId?.[id] ?? spec.defaultChoice
      answers[id] = { type: 'choice', choice: options.includes(desired) ? desired : options[0], confidence: 0.99 }
    } else if (question.type === 'score') answers[id] = { type: 'score', score: 0, confidence: 0.99 }
    else answers[id] = { type: 'noul', noul: spec.noulByQuestionId?.[id] ?? spec.defaultNoul ?? 0.9 }
  }
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ model: spec.model, answers,
    usage: spec.usage ?? { input_tokens: 4, output_tokens: 2 } }))
})
server.listen(0, '127.0.0.1', () => {
  writeFileSync(readyPath, JSON.stringify({ port: server.address().port, pid: process.pid }) + '\n')
})

for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)))
