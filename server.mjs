import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import { createPublicClient, decodeEventLog, http, isAddress, keccak256, stringToHex } from 'viem'
import abi from './src/generated/abi.json' with { type: 'json' }

try { loadEnvFile('.env') } catch { /* environment variables may be provided by the host */ }
const root = process.cwd()
const dataDir = process.env.DATA_DIR || join(root, 'data')
const file = join(dataDir, 'content.json')
const contract = process.env.CONTRACT_ADDRESS || process.env.VITE_CONTRACT_ADDRESS
const client = createPublicClient({ transport: http(process.env.MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz') })
let db = { seasons: {}, contributions: {} }
try { db = JSON.parse(await readFile(file, 'utf8')) } catch { /* new installation */ }

function reply(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}
function safeUrl(value) {
  try { return ['https:', 'http:'].includes(new URL(value).protocol) } catch { return false }
}
function validate(kind, content) {
  if (!content || typeof content !== 'object') return 'Missing content'
  const max = kind === 'season' ? 3000 : 1500
  for (const value of Object.values(content)) if (typeof value === 'string' && value.length > max) return 'Text too long'
  if (kind === 'season') {
    if (!content.title || !content.story || !content.community || !safeUrl(content.workUrl)) return 'Complete the season story and work URL'
    if (content.coverUrl && !safeUrl(content.coverUrl)) return 'Invalid cover URL'
  } else {
    if (!content.title || !content.description || !safeUrl(content.evidenceUrl) || content.consent !== true) return 'Complete evidence and consent'
  }
  return null
}
async function save() {
  await mkdir(dataDir, { recursive: true })
  await writeFile(file + '.tmp', JSON.stringify(db, null, 2))
  const { rename } = await import('node:fs/promises')
  await rename(file + '.tmp', file)
}
async function bodyJson(req) {
  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 100_000) throw new Error('Request too large')
  }
  return JSON.parse(raw)
}
async function verify(kind, id, content, txHash) {
  if (!isAddress(contract || '')) throw new Error('Contract is not configured')
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash || '')) throw new Error('Invalid transaction hash')
  const receipt = await client.getTransactionReceipt({ hash: txHash })
  if (receipt.status !== 'success') throw new Error('Transaction failed')
  const eventName = kind === 'season' ? 'SeasonCreated' : 'ContributionSubmitted'
  const matched = receipt.logs.some(log => {
    if (log.address.toLowerCase() !== contract.toLowerCase()) return false
    try {
      const event = decodeEventLog({ abi, data: log.data, topics: log.topics })
      return event.eventName === eventName && Number(event.args[kind === 'season' ? 'seasonId' : 'contributionId']) === id
    } catch { return false }
  })
  if (!matched) throw new Error('Transaction does not contain the matching event')
  const onchain = await client.readContract({ address: contract, abi, functionName: kind === 'season' ? 'getSeason' : 'getContribution', args: [BigInt(id)] })
  const hash = keccak256(stringToHex(JSON.stringify(content)))
  if (onchain[kind === 'season' ? 'metadataHash' : 'contentHash'].toLowerCase() !== hash.toLowerCase()) throw new Error('Content hash differs from chain')
  return hash
}

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' }
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    if (url.pathname === '/api/health') return reply(res, 200, { ok: true, contractConfigured: isAddress(contract || '') })
    const match = url.pathname.match(/^\/api\/(season|contribution)\/(\d+)$/)
    if (match) {
      const [, kind, idText] = match
      const id = Number(idText)
      if (!Number.isSafeInteger(id) || id < 1) return reply(res, 400, { error: 'Invalid ID' })
      const table = kind === 'season' ? 'seasons' : 'contributions'
      if (req.method === 'GET') return reply(res, db[table][id] ? 200 : 404, db[table][id] || { error: 'Content unavailable' })
      if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed' })
      const { content, txHash } = await bodyJson(req)
      const error = validate(kind, content)
      if (error) return reply(res, 400, { error })
      const hash = await verify(kind, id, content, txHash)
      db[table][id] = { content, hash, txHash, savedAt: new Date().toISOString() }
      await save()
      return reply(res, 200, { ok: true, hash })
    }
    if (req.method !== 'GET') return reply(res, 405, { error: 'Method not allowed' })
    const dist = resolve(root, 'dist')
    const requested = resolve(dist, '.' + url.pathname)
    const path = requested.startsWith(dist + '/') && extname(requested) ? requested : join(dist, 'index.html')
    try {
      await stat(path)
      res.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' })
      res.end(await readFile(path))
    } catch { reply(res, 404, { error: 'Not found' }) }
  } catch (error) { reply(res, 400, { error: error.message || 'Request failed' }) }
}).listen(Number(process.env.PORT || 4173), process.env.HOST || '127.0.0.1', () => console.log(`End Credits listening on http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 4173}`))
