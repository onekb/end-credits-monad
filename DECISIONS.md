# Decisions and current limits

## 2026-09-27

- **Product name:** 片尾字幕 / End Credits. A season is one release or event, not an ongoing royalty stream.
- **Default split:** 20% of this app's season tips to eligible contributors, configurable 5–30% before publication. There is no platform fee.
- **Review:** three distinct addresses, two approvals per contribution. Reviewer self-review is blocked in the contract.
- **Payment:** use the Circle Monad Testnet USDC contract at `0x534b2f3A21130d7a60830c2Df862319e593943A3`. Its six decimals were checked by calling the Testnet contract on 2026-09-27. The app labels every balance as Testnet.
- **Wallet:** standard injected EVM wallet for MVP. Browser-based Mera passkey setup and recovery were not proven, so the Mera bounty must not be claimed.
- **Content:** original stories and contribution evidence URLs are stored by the Node content API only after it verifies a successful matching chain transaction and Keccak hash. The contract stores only hashes, addresses, categories, votes and payout state. A season creator can sign a message to hide disputed contribution display material; the API stops serving the raw material while on-chain votes and payouts stay intact. No file uploads in this version. If content storage is lost, the public page says the original material is unavailable.
- **Persistence:** the first API implementation uses an atomic local JSON file. A persistent writable disk is required in production. This is suitable for a small hackathon MVP, not a distributed deployment.
- **Demo data:** homepage's example is explicitly marked conceptual and off-chain. No real community, reviewers or traction are claimed without evidence.
- **Testnet deployment:** blocked until a gas-funded Monad Testnet address is available. The fresh isolated deployer address is `0xe1DA8Ed54F0c52a46b2bde73EF8d04eE4E7d2EAE`; its private key is held only in the gitignored `.deploy.env` file. Alchemy and QuickNode faucets require mainnet wallet history or balance; the official faucet currently presents a security checkpoint in Chrome. Do not publish the private key.

## Before judging

1. Deploy the contract with `node scripts/deploy.mjs` after funding the deployer with test MON.
2. Put the site and content API on a stable public host with a persistent disk and set the generated `.env` variables.
3. Recruit a real project/community and three consenting reviewer addresses. Publish a real season and collect real contribution evidence.
4. Run five-address product testing and collect feedback from five people unfamiliar with Web3.
5. Record real operation videos; do not present local tests or conceptual copy as user traction.
