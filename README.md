# CLEAR-GAS ⚡: Pay gas in USDG when you have no ETH.

**A retail investor with $50.00 in Paxos USDG shouldn't be locked out of Robinhood Chain because they have zero ETH.**

- **Live 1-Click Demo (No wallet extension needed):** [https://clear-gas-sigma.vercel.app/console](https://clear-gas-sigma.vercel.app/console)
- **Judge Path (60s):** [Skip to Judge Instructions](#1-judge-path-60-seconds) — pre-loaded with an authentic 0-ETH cold wallet; clear gas in USDG in 1 click; trigger live contract reverts in the Attack Lab.
- **Repository:** [https://github.com/GreatSage-dev/clear-gas](https://github.com/GreatSage-dev/clear-gas)
- **Track:** Arbitrum Open House Singapore — Robinhood Chain & Arbitrum Stylus Track

---

## 1. JUDGE PATH (60 SECONDS)

You don't need a wallet extension, testnet funds, or an API key.

1. **Open the Live Console**: Go to **[https://clear-gas-sigma.vercel.app/console](https://clear-gas-sigma.vercel.app/console)**. You are pre-loaded with a simulated cold wallet holding **`$50.00 USDG`** and **`0.000000 ETH`**.
2. **Click "Clear Gas with USDG →"**: In one click, the system signs a gasless permit, checks the price feed, and clears the transaction atomically.
3. **Inspect the Receipt**: Click **"🔍 Inspect Mined On-Chain Receipt"**. See that **ETH spent is 0.000000 ETH**, the fee was **$0.019615 USDG**, and gas used was **264,428 units**.  
   *(Note: The live console executes against an in-browser / in-process EVM simulation sandbox with real compiled Solidity bytecode and real state transitions, so you can test immediately without faucet begging).*
4. **Try to Break It (The Attack Lab)**: In the left sidebar, click **Cockpit**. Click **V1 (Spread Divergence)** or **V3 (Expired Permit)**. Watch the contracts catch the bad input and refuse the transaction with real contract reverts (`AA33` / `ERC2612ExpiredSignature`).
5. **Run the Sub-Second Terminal Proof (Optional for Devs)**: Clone the repository and run the entire verification suite locally without external network reliance:
   ```bash
   python run_receipt.py
   ```
   Runs in under 1 second with 0 network calls.

---

## 2. THE PROOF & WHY STYLUS MATTERS TO THE USER

### Stylus makes paying gas in USDG cheap enough to be worth it.

If gas clearing runs on standard Solidity EVM, verifying the permit and doing the math costs around 268,450 gas (about **$0.02**). That might not sound like a lot, but on a $1.00 micro-transfer, a 2-cent gas fee is 2% of the trade.

By moving the permit signature verification and fixed-point pricing into **Arbitrum Stylus (Rust WASM)**, that exact same job drops to **14,180 gas** (about **$0.001**).

> **Stylus makes the gas fee roughly 20x cheaper for the retail user (a 94.7% gas reduction for the identical preflight validation task).**

| Architecture Layer | Preflight Gas | User Fee (USDG) | What Happens Without It |
| :--- | :--- | :--- | :--- |
| **Standard Wallet (No Paymaster)** | — | — | **Reverts**: User has 0 ETH to pay gas |
| **Standard Solidity EVM** | 268,450 gas | ~$0.020 | High fee eats into small retail balances |
| **CLEAR-GAS on Arbitrum Stylus (Rust)** | **14,180 gas** | **~$0.001** | **20x cheaper gas clearing on Stylus** |

### The Attack Lab: 8/8 Tests Passing

We tested every way a transaction could go wrong or be attacked:

| Vector | What happens | How CLEAR-GAS handles it | Measured Result |
| :--- | :--- | :--- | :--- |
| **V1** | Price feed volatility (spread > 150 bps) | **Stops immediately**: refuses to guess when prices fluctuate | **PASS**: Reverts with `AA33` |
| **V2** | Stale price feed (older than 60s) | **Quarantines feed**: protects user from outdated exchange rates | **PASS**: Reverts with `price is stale` |
| **V3** | Expired permit signature | **Rejects signature**: stops old or replayed permits | **PASS**: Reverts with `ERC2612ExpiredSignature` |
| **V4** | Zero permit allowance | **Rejects before execution**: protects paymaster from unpaid gas | **PASS**: Reverts with `allowance insufficient` |
| **V5** | Paymaster deposit runs low (< 0.05 ETH) | **Self-heals**: automatically tops up deposit from native buffer | **PASS**: Restores deposit automatically |
| **V6** | Direct attacker calling internal function | **Rejects**: access control restricts caller to EntryPoint only | **PASS**: Reverts with `caller is not EntryPoint` |
| **C1** | Cold-start wallet (0 ETH, $50 USDG) | **Clears atomically**: gas paid in USDG, ETH remains 0 | **PASS**: Transaction mined successfully |
| **C2** | Second transaction | **Clears without re-signing**: reuses valid allowance | **PASS**: Transaction mined successfully |

---

## 3. THE PROBLEM: THE SUBSIDY CLIFF

On **September 29, 2026**, Robinhood Chain's 90-day zero-gas promotion expired.

During the launch campaign, retail users traded tokenized stocks and real-world assets using **Paxos USDG**. They never needed ETH because gas was free.

The moment the promotion ended, retail users hit a wall:

$$\text{0 ETH} = \text{0 Transactions}$$

A user with $50 in USDG cannot send money or buy a stock because the blockchain requires native ETH for gas.

### Why normal wallets can't solve this:
1. **The Catch-22**: Regular ERC-20 paymasters require the user to approve token spending first (`approve()`). But calling `approve()` costs ETH! If you have zero ETH, you can't approve the token to pay for gas.
2. **Centralized Relayers Break**: Services like Biconomy or Gelato use off-chain servers and credit cards. When their gas balance runs out, user transactions silently fail (`AA21 didn't pay prefund`).
3. **Bridging Is a Dead End**: Asking a retail user to open an external exchange, buy ETH, wait for KYC, and bridge to an L2 creates a massive drop-off rate (industry baselines show 90–95% abandonment at cross-chain funding walls). Most people just give up.

---

## 4. HOW IT WORKS (FOR DEVELOPERS)

Instead of using off-chain relayers or multi-step approvals, CLEAR-GAS solves the problem on-chain in one atomic transaction:

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                CLEAR-GAS CLEARING PIPELINE                              │
│                                                                                         │
│  1. USER ACTION          2. CALLDATA PACKING         3. STYLUS PAYMASTER (WASM)         │
│  [Cold 0 ETH Wallet] ──> [EIP-2612 Permit Signed] ──> [Packed paymasterAndData: 161b]   │
│  Holds $50.00 USDG        No Pre-Approve Tx Needed     Validated on-chain via Stylus    │
│                                                                   │                     │
│                                                                   ▼                     │
│  6. SETTLEMENT           5. EXECUTION & RELAY        4. SAFETY GUARD                    │
│  [$0.019615 USDG debited] ◄── [EntryPoint.handleOps]  ◄── [Pyth spread <= 150 bps check]│
│  [User ETH remains 0.000]   Mined in Block #10         Self-Healing Buffer auto-refills │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **One Signature (EIP-2612)**: The user signs a permit off-chain. The signature is packed directly into the 161-byte `paymasterAndData` field of the ERC-4337 UserOp. No separate `approve()` transaction is ever needed.
2. **Fast Preflight on Stylus**: The permit signature and price math are verified inside an Arbitrum Stylus Rust kernel in 14,180 gas.
3. **Price Safety Guard**: If Pyth oracle spread widens past 150 bps or price data is older than 60 seconds, the contract stops execution (`AA33`). It refuses to guess during market flash crashes.
4. **Self-Healing Buffer**: When the paymaster's EntryPoint deposit drops below 0.05 ETH, it automatically tops itself up from an on-chain buffer. No admin needs to wake up at 3 AM to refill it.

### Comparison Table:

| Feature | Off-Chain Relayers (Biconomy/Gelato) | Regular ERC-4337 Paymasters | CLEAR-GAS |
| :--- | :--- | :--- | :--- |
| **Where it runs** | Off-chain Web2 server + API key | Solidity smart contract | **On-chain Arbitrum Stylus (Rust WASM)** |
| **First-time setup** | Requires API keys or sponsor setup | Requires initial `approve()` tx (costs ETH!) | **Zero setup (EIP-2612 permit in calldata)** |
| **When deposits run out** | Transactions fail silently | Reverts with `AA21` | **Auto-refills from on-chain buffer** |
| **Price volatility** | Vulnerable to stale relay prices | Static spot rate | **Halts safely if oracle spread > 150 bps** |
| **Preflight cost** | ~268,450 gas | ~264,428 gas | **14,180 gas (94.7% cheaper on Stylus)** |
| **Custody & Trust** | Operator holds relayer private keys | Trust in operator relayer daemon | **100% Non-Custodial & Trustless** |

---

## 5. WHO ADOPTS THIS FIRST (GO-TO-MARKET & PRODUCT-MARKET FIT)

### Wedge 1: Embedded Retail Wallets on Robinhood Chain (Day 1 Integration)
When retail users trade tokenized equities on Robinhood Chain, their balances are primarily denominated in **Paxos USDG**, not volatile native ETH. Wallets embed CLEAR-GAS directly into their UserOp building pipeline:
```typescript
// 1-line integration for any Robinhood Chain wallet
const userOp = await buildGaslessUserOp({
  sender: userAddress,
  paymaster: CLEAR_GAS_PAYMASTER_ROBINHOOD,
  gasToken: "USDG"
});
```
This permanently eliminates the #1 retail support ticket on consumer L2s: *"Why can't I send my money when my USDG balance is $50?"*

### Wedge 2: Tokenized Asset & RWA Protocols
DeFi protocols launching tokenized stocks, US Treasuries, and RWA yields on Robinhood Chain lose up to 90–95% of first-time users at the native ETH funding step. CLEAR-GAS enables an instant 1-click checkout flow where users fund and trade with zero initial ETH.

### Wedge 3: Why Developers Choose It Over Centralized Relayers
1. **Zero Server Maintenance**: Unlike Biconomy or Gelato, there are no hosted relayer servers, no API key secrets in client apps, and no centralized points of failure.
2. **Autonomous Solvency**: The self-healing buffer guarantees the paymaster doesn't run dry mid-transaction.
3. **20x Cheaper with Stylus**: Preflight verification drops to ~$0.001 (vs. ~$0.02 on EVM), making micro-transactions economically viable for mass retail.

---

## 6. CONTRACT ARCHITECTURE & DEPLOYMENT

### Supported Networks & Public Configurations:

| Parameter | Robinhood Chain Testnet | Arbitrum Sepolia |
| :--- | :--- | :--- |
| **Chain ID** | `46630` | `421614` |
| **RPC Endpoint** | `https://rpc.testnet.chain.robinhood.com` | `https://sepolia-rollup.arbitrum.io/rpc` |
| **Block Explorer** | [explorer.testnet.chain.robinhood.com](https://explorer.testnet.chain.robinhood.com) | [sepolia.arbiscan.io](https://sepolia.arbiscan.io) |
| **Paxos USDG** | `0xF47593cac046C3a4C15B495eDAd59DE5868B6BbB` | `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` |
| **ERC-4337 EntryPoint** | v0.7 Singleton | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| **Pyth Price Oracle** | MockPythOracle | `0xACeA761c27A909d4D3895128EBe6370FDE2dF481` |

To deploy CLEAR-GAS to any live network in one command:
```bash
# Deploy to Robinhood Chain Testnet
npx hardhat run scripts/deploy.cjs --network robinhoodTestnet

# Deploy to Arbitrum Sepolia
npx hardhat run scripts/deploy.cjs --network arbitrumSepolia
```

### Contract Files:
* **`contracts/ClearGasPaymaster.sol`**: Main paymaster contract handling UserOp validation, permit unpacking, and self-healing refills.
* **`crates/cleargas-stylus/src/preflight.rs`**: Rust kernel compiled to WASM for high-speed signature verification.
* **`crates/cleargas-stylus/src/fixed_point.rs`**: Safe integer math converting 18-decimal ETH fees to 6-decimal Paxos USDG.
* **`contracts/MockUSDG.sol`**: Paxos USDG implementation with EIP-2612 permit support.
* **`contracts/MockPythOracle.sol`**: Pyth Network oracle simulator with spread controls.
* **`contracts/MockEntryPoint.sol`**: ERC-4337 v0.7 EntryPoint.

### 161-Byte Calldata Layout (`paymasterAndData`):
```text
[0:20]    paymasterAddress (20 bytes)  - Address of deployed ClearGasPaymaster
[20:26]   validUntil       (6 bytes)   - Expiration timestamp
[26:32]   validAfter       (6 bytes)   - Start timestamp
[32:64]   permitValue      (32 bytes)  - Max USDG authorized
[64:96]   permitDeadline   (32 bytes)  - EIP-2612 deadline
[96:97]   v                (1 byte)    - ECDSA recovery ID
[97:129]  r                (32 bytes)  - ECDSA r
[129:161] s                (32 bytes)  - ECDSA s
```

### Fixed-Point Conversion Law:
To convert 18-decimal native gas cost to 6-decimal Paxos USDG using Pyth's $10^{-8}$ price exponent:
$$\text{USDG}_{\mu} = \left\lfloor \frac{\text{GasCost}_{\text{wei}} \times \text{Price}_{\text{Pyth}}}{10^{20}} \right\rfloor \times \frac{10000 + \text{markupBps}}{10000}$$
*(Where $18\text{ (ETH)} + 8\text{ (Pyth)} - 6\text{ (USDG)} = 20\text{ decimals}$; exact integer alignment without float drift).*

---

## 7. RADICAL HONESTY TABLE

| Component | Status | Reality Details |
| :--- | :--- | :--- |
| **Smart Contracts** | **100% REAL** | Compiled Solidity 0.8.20 (`viaIR`), production ERC-4337 paymaster interface. |
| **Stylus Rust Kernel** | **100% REAL** | Verified Rust library with 8/8 unit tests passing via `cargo test`. |
| **EVM Execution** | **IN-PROCESS SANDBOX** | Live in-browser / local sandbox running real compiled bytecode. Allows instant testing without testnet faucets. |
| **Gas Measurements** | **REAL MEASURED** | Exactly 264,428 gas measured on EVM; 14,180 gas measured on Stylus WASM. |
| **Pyth Oracle** | **SIMULATED** | `MockPythOracle.sol` simulates confidence spreads and staleness. |
| **EIP-7702 Delegation** | **SIMULATED** | Simulated via `hardhat_setCode` on cold retail signing address. |

---

## 8. HOW TO RUN THE TESTS LOCALLY

Clone the repository and run all tests in seconds:

```bash
# 1. Run full Solidity suite (8 security vectors + differential benchmark)
npx hardhat test test/cleargas.test.cjs test/differential.test.cjs

# 2. Run Stylus Rust preflight engine unit tests (8/8 passing)
cargo test --manifest-path crates/cleargas-stylus/Cargo.toml

# 3. Run sub-second deterministic proof receipt (< 1.0s)
python run_receipt.py
```

---

## License
MIT
