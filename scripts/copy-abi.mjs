import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
const artifact = JSON.parse(readFileSync('out/EndCredits.sol/EndCredits.json', 'utf8'))
mkdirSync('src/generated', { recursive: true })
writeFileSync('src/generated/abi.json', JSON.stringify(artifact.abi, null, 2) + '\n')
