import { readFileSync, writeFileSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { createPublicClient, createWalletClient, defineChain, http, isAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

loadEnvFile('.deploy.env')
const rpc = process.env.MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz'
const token = process.env.TOKEN_ADDRESS || '0x534b2f3A21130d7a60830c2Df862319e593943A3'
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY)
const chain = defineChain({ id: 10143, name: 'Monad Testnet', nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } })
const publicClient = createPublicClient({ chain, transport: http(rpc) })
if (await publicClient.getChainId() !== 10143) throw new Error('RPC is not Monad Testnet')
if (!isAddress(token)) throw new Error('Invalid token address')
const tokenAbi = [
  { type: 'function', name: 'decimals', inputs: [], outputs: [{ type: 'uint8' }], stateMutability: 'view' },
  { type: 'function', name: 'symbol', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
]
const decimals = Number(await publicClient.readContract({ address: token, abi: tokenAbi, functionName: 'decimals' }))
const symbol = await publicClient.readContract({ address: token, abi: tokenAbi, functionName: 'symbol' })
const balance = await publicClient.getBalance({ address: account.address })
if (!balance) throw new Error(`No test MON for deployer ${account.address}`)
const artifact = JSON.parse(readFileSync('out/EndCredits.sol/EndCredits.json', 'utf8'))
const wallet = createWalletClient({ account, chain, transport: http(rpc) })
const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [token] })
const receipt = await publicClient.waitForTransactionReceipt({ hash })
if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`Deployment failed: ${hash}`)
const config = [
  'VITE_CHAIN_ID=10143', `VITE_RPC_URL=${rpc}`, 'VITE_EXPLORER_URL=https://testnet.monadscan.com',
  `VITE_CONTRACT_ADDRESS=${receipt.contractAddress}`, `VITE_TOKEN_ADDRESS=${token}`,
  `VITE_TOKEN_SYMBOL=${symbol}`, `VITE_TOKEN_DECIMALS=${decimals}`,
  `VITE_DEPLOYMENT_BLOCK=${receipt.blockNumber}`, `MONAD_RPC_URL=${rpc}`, `CONTRACT_ADDRESS=${receipt.contractAddress}`, 'PORT=4173',
].join('\n') + '\n'
writeFileSync('.env', config)
console.log(JSON.stringify({ contract: receipt.contractAddress, tx: hash, block: String(receipt.blockNumber), token, decimals, symbol }))
