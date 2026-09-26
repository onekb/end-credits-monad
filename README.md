# 片尾字幕 · End Credits

A Monad Testnet hackathon MVP for visible, verified community contribution and a fixed share of tips received inside this app. Each season has three reviewers, a 2-of-3 approval rule, immutable contribution weights, and pull-payment ERC-20 distribution.

**Status:** Contract and local web app are implemented and tested. Monad Testnet deployment and public hosting are pending test MON and a durable hosting account. The homepage sample is explicitly conceptual. See [DECISIONS.md](DECISIONS.md).

## Stack

- Solidity 0.8.28 + OpenZeppelin 5, Foundry
- React 19 + TypeScript + Vite + viem
- Small Node content API backed by an atomic JSON file; content hashes verified against confirmed contract state

## Setup and test

```sh
npm install
forge build
forge test --summary
npm run build
node server.mjs
```

Open `http://127.0.0.1:4173`. Without `.env`, creation and transactions are deliberately disabled; the sample is marked off-chain. For frontend hot reload, run `npm run dev` alongside the API server.

## Monad Testnet deployment

Network: chain ID `10143`, public RPC `https://testnet-rpc.monad.xyz`, explorer `https://testnet.monadscan.com`. The intended token is Circle test USDC `0x534b2f3A21130d7a60830c2Df862319e593943A3`, 6 decimals. Verify its contract and decimals again before deployment. Obtain test MON for gas from a faucet. Circle's faucet supplies test USDC; MON gas and USDC are distinct.

Put a throwaway deployer key in gitignored `.deploy.env` as `DEPLOYER_PRIVATE_KEY=0x…`, then run:

```sh
forge build
node scripts/deploy.mjs
npm run build
node server.mjs
```

The deployment script checks chain ID, token symbol/decimals and nonzero gas balance, deploys the contract, and writes the public configuration to gitignored `.env`. Never commit `.deploy.env`, personal wallet keys, reviewer credentials or private evidence.

For hosted operation, set the same variables as `.env.example`, configure `HOST=0.0.0.0` and a persistent writable `data/` directory, and run `npm run build && npm start`. Set `VITE_DEPLOYMENT_BLOCK` to the deployment block to keep ledger queries bounded. Use HTTPS for wallet connection.

## Product rules

- A season fixes one payout address, one token, three reviewers, three deadlines, metadata hash and 5–30% contributor share at publication.
- Up to 40 submissions and 20 unique contributors; category points are 3 for guide/translation, 2 for visual/event, 1 for documented help.
- Review begins when submissions close. Two approvals qualify a submission; two rejections disqualify it. Reviewers cannot vote on their own submissions. Unresolved submissions do not qualify.
- Anyone can lock the list after review ends. With no eligible contributions, the season cannot receive tips. Tips open only after a nonempty list is finalized and close at the stated deadline.
- Tip `amount` credits `floor(amount × contributorBps / 10,000)` to the contributor pool and the rest to the creator. Claims go directly to the predetermined recipient. After closing, the first eligible contributor receives at most one base unit of rounding dust per other eligible contributor.
- The promise covers only tips received by this contract for this season. It does not cover external revenue, equity, copyright, or guaranteed earnings. Testnet tokens have no monetary value.

## Verification and known limits

`npm run check` builds the app, runs six Foundry contract tests, then starts an Anvil node and validates the content API against real local transactions. Coverage includes payout conservation, rounding, deadlines, caps, duplicate and self review, withdrawal, empty season, fee-token rejection, reentrancy rejection, hash tampering, and creator-signed hiding of disputed material. The web app was visually checked in Chrome. This is unaudited testnet code; independent contract review is required before handling real value. The current content API does not support file uploads or distributed storage. Browser wallet signing, public hosting, a genuine community season and five-person usability testing remain to be completed.
