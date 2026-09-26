import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPublicClient, createWalletClient, decodeEventLog, defineChain, http, keccak256, stringToHex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import abi from '../src/generated/abi.json' with { type: 'json' }

const rpc = 'http://127.0.0.1:18545'
const api = 'http://127.0.0.1:18546'
const chain = defineChain({ id: 31337, name: 'Anvil', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } })
const deployer = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80')
const client = createPublicClient({ chain, transport: http(rpc) })
const wallet = createWalletClient({ account: deployer, chain, transport: http(rpc) })
const pause = ms => new Promise(r => setTimeout(r, ms))
async function ready(check) { for (let i = 0; i < 30; i++) { try { if (await check()) return } catch { /* starting */ } await pause(100) } throw new Error('Local service did not start') }

test('content API accepts only a confirmed matching on-chain story', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'end-credits-'))
  const anvil = spawn('anvil', ['--port', '18545', '--silent'], { stdio: 'ignore' })
  let server
  try {
    await ready(() => client.getChainId())
    const tokenArtifact = JSON.parse(readFileSync('out/EndCredits.t.sol/TestToken.json', 'utf8'))
    const tokenTx = await wallet.deployContract({ abi: tokenArtifact.abi, bytecode: tokenArtifact.bytecode.object })
    const token = (await client.waitForTransactionReceipt({ hash: tokenTx })).contractAddress
    const contractArtifact = JSON.parse(readFileSync('out/EndCredits.sol/EndCredits.json', 'utf8'))
    const contractTx = await wallet.deployContract({ abi, bytecode: contractArtifact.bytecode.object, args: [token] })
    const contract = (await client.waitForTransactionReceipt({ hash: contractTx })).contractAddress
    server = spawn('node', ['server.mjs'], { stdio: 'ignore', env: { ...process.env, PORT: '18546', HOST: '127.0.0.1', DATA_DIR: dir, MONAD_RPC_URL: rpc, CONTRACT_ADDRESS: contract } })
    await ready(async () => (await fetch(`${api}/api/health`)).ok)
    const content = { title: 'Integration test season', story: 'Real contract hash', community: 'Test only', workUrl: 'https://example.org/work', coverUrl: '', rules: '20% of in-app tips only.' }
    const now = Number((await client.getBlock()).timestamp)
    const reviewers = ['0x0000000000000000000000000000000000000001', '0x0000000000000000000000000000000000000002', '0x0000000000000000000000000000000000000003']
    const createTx = await wallet.writeContract({ address: contract, abi, functionName: 'createSeason', args: [{ payoutAddress: deployer.address, reviewers, submissionEnd: BigInt(now + 3600), reviewEnd: BigInt(now + 7200), tipEnd: BigInt(now + 7200 + 172800), contributorBps: 2000, metadataHash: keccak256(stringToHex(JSON.stringify(content))) }] })
    const receipt = await client.waitForTransactionReceipt({ hash: createTx })
    const event = receipt.logs.map(x => { try { return decodeEventLog({ abi, data: x.data, topics: x.topics }) } catch { return null } }).find(x => x?.eventName === 'SeasonCreated')
    assert.equal(Number(event.args.seasonId), 1)
    const post = async value => fetch(`${api}/api/season/1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: value, txHash: createTx }) })
    assert.equal((await post({ ...content, story: 'Tampered' })).status, 400)
    assert.equal((await post(content)).status, 200)
    const saved = await (await fetch(`${api}/api/season/1`)).json()
    assert.deepEqual(saved.content, content)
    assert.equal(saved.hash, keccak256(stringToHex(JSON.stringify(content))))
    const contribution = { title: 'Translated guide', description: 'A published translation', evidenceUrl: 'https://example.org/translation', displayName: 'Contributor', consent: true }
    const contributionTx = await wallet.writeContract({ address: contract, abi, functionName: 'submitContribution', args: [1n, 0, keccak256(stringToHex(JSON.stringify(contribution)))] })
    await client.waitForTransactionReceipt({ hash: contributionTx })
    const contributionPost = await fetch(`${api}/api/contribution/1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: contribution, txHash: contributionTx }) })
    assert.equal(contributionPost.status, 200)
    assert.deepEqual((await (await fetch(`${api}/api/contribution/1`)).json()).content, contribution)
    const reason = 'Possible rights dispute'
    const message = `End Credits hide contribution #1 on ${contract}: ${reason}`
    const hide = async signature => fetch(`${api}/api/contribution/1/hide`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason, signature }) })
    assert.equal((await hide(await privateKeyToAccount(generatePrivateKey()).signMessage({ message }))).status, 403)
    assert.equal((await hide(await deployer.signMessage({ message }))).status, 200)
    const hidden = await (await fetch(`${api}/api/contribution/1`)).json()
    assert.equal(hidden.hidden, true)
    assert.equal(hidden.content, undefined)
    assert.equal((await fetch(`${api}/api/contribution/1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: contribution, txHash: contributionTx }) })).status, 409)
  } finally {
    server?.kill()
    anvil.kill()
    await rm(dir, { recursive: true, force: true })
  }
})
