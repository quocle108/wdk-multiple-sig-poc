# Multisig Wallet POC

Proof-of-concept for Bitcoin and EVM multisig wallets with P2P coordination.

## Features

- **Bitcoin P2WSH** - Native SegWit multisig on Bitcoin/Testnet
- **Safe Protocol** - Smart contract multisig on EVM chains (Ethereum, Polygon, Arbitrum)
- **ERC-4337 Account Abstraction** - Bundler-based execution with ERC-20 gas payment
- **Owner Management** - Add/remove owners and change threshold (Safe only)
- **Flexible Storage** - P2P sync (Autobase), in-memory (testing), or manual export/import
- **Simple API** - Same workflow for both Bitcoin and EVM

## Quick Start

### 1. Install

```bash
npm install
```

### 2. Configure

Create `.env` file:

```env
ALICE_SEED_PHRASE="your twelve word seed phrase here ..."
BOB_SEED_PHRASE="another twelve word seed phrase here ..."
SEPOLIA_RPC=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
```

### 3. Run Examples

```bash
# Fast testing (in-memory storage)
node examples/example-evm-memory.js
node examples/example-bitcoin-memory.js

# ERC-4337 with bundler
node examples/example-evm-4337-memory.js              # ETH gas
node examples/example-evm-4337-memory.js --paymaster  # USDC gas

# P2P coordination (Autobase storage)
node examples/example-evm-autobase.js
node examples/example-bitcoin-autobase.js

# Safe owner management
node examples/example-safe-owner-management.js
```

## Usage

### EVM (Safe Protocol)

```javascript
import { SafeMultisigEVM } from './src/SafeMultisigEVM.js'
import { MemoryStorageAdapter } from './src/storages/MemoryStorageAdapter.js'

// Setup storage
const storage = new MemoryStorageAdapter()
await storage.init()

// Create manager
const alice = new SafeMultisigEVM(aliceSeed, "0'/0/0", {
  provider: 'https://eth-sepolia.g.alchemy.com/v2/KEY',
  network: 'sepolia',
  storage
})

// Create 2-of-2 multisig
await alice.create([aliceAddress, bobAddress], 2)

// Propose transaction
const proposalId = await alice.propose({
  to: '0x...',
  value: '1000000000000000' // 0.001 ETH in wei
})

// Bob signs
await bob.sign(proposalId)

// Execute (needs 2 signatures)
await alice.execute(proposalId)
```

### Owner Management (Safe Only)

```javascript
// Add new owner
const result = await alice.addOwner(charlieAddress, 2)
await bob.sign(result.proposalId)
await alice.execute(result.proposalId)

// Change threshold
const result = await alice.changeThreshold(3)
await bob.sign(result.proposalId)
await alice.execute(result.proposalId)

// Remove owner
const result = await alice.removeOwner(charlieAddress, 2)
await bob.sign(result.proposalId)
await charlie.sign(result.proposalId)
await alice.execute(result.proposalId)
```

### EVM with ERC-4337 (Account Abstraction)

ERC-4337 enables bundler-based execution and gas sponsorship via paymasters.

```javascript
import { SafeMultisigEVM4337 } from './src/SafeMultisigEVM4337.js'
import { MemoryStorageAdapter } from './src/storages/MemoryStorageAdapter.js'

// Setup storage
const storage = new MemoryStorageAdapter()
await storage.init()

// Create manager with bundler
const alice = new SafeMultisigEVM4337(aliceSeed, "0'/0/0", {
  provider: 'https://eth-sepolia.g.alchemy.com/v2/KEY',
  network: 'sepolia',
  bundlerUrl: 'https://api.pimlico.io/v2/sepolia/rpc?apikey=KEY',
  storage
})

// Create 2-of-2 multisig (deterministic address)
await alice.create([aliceAddress, bobAddress], 2)

// Propose transaction (pays gas in ETH)
const proposalId = await alice.propose({
  to: '0x...',
  value: '1000000000000000'
})

// Or pay gas in USDC via paymaster
const proposalId = await alice.propose({
  to: '0x...',
  value: '1000000000000000'
}, {
  paymasterTokenAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' // USDC on Sepolia
})

// Bob signs
await bob.sign(proposalId)

// Execute via bundler (no ETH needed for gas if using paymaster)
await alice.execute(proposalId)
```

### Bitcoin

```javascript
import { BitcoinMultisig } from './src/BitcoinMultisig.js'

// Create manager
const alice = new BitcoinMultisig(aliceSeed, "0'/0/0", {
  network: 'testnet',
  storage
})

// Create 2-of-2 multisig (using public keys)
const alicePubkey = alice.getPublicKey()
const bobPubkey = bob.getPublicKey()
await alice.create([alicePubkey, bobPubkey], 2)

// Propose transaction (same workflow as Safe)
const proposalId = await alice.propose({
  to: 'tb1q...',
  value: 10000 // satoshis
})

await bob.sign(proposalId)
await alice.execute(proposalId)
```

## Storage Options

### Memory Storage (Fast Testing)

```javascript
import { MemoryStorageAdapter } from './src/storages/MemoryStorageAdapter.js'

const storage = new MemoryStorageAdapter()
await storage.init()

// Both managers share same storage
const alice = new SafeMultisigEVM(aliceSeed, path, { storage })
const bob = new SafeMultisigEVM(bobSeed, path, { storage })
```

**Use for:** Unit tests, quick experiments, learning

### Autobase Storage (P2P Sync)

```javascript
import { AutobaseStorageAdapter } from './src/storages/AutobaseStorageAdapter.js'

// Alice (bootstrap node)
const aliceStorage = new AutobaseStorageAdapter({ nodeId: 'alice' })
await aliceStorage.init()

// Bob (connects to Alice)
const bobStorage = new AutobaseStorageAdapter({
  nodeId: 'bob',
  bootstrapKey: aliceStorage.base.key
})
await bobStorage.init()
```

**Use for:** P2P coordination, distributed teams

## Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                   ┌─────────────────────┐                         │
│                   │  MultisigManager    │                         │
│                   │  (Abstract Base)    │                         │
│                   └──────────┬──────────┘                         │
│                              │ extends                            │
│       ┌──────────────────────┼──────────────────────┐             │
│       │                      │                      │             │
│ ┌─────▼─────────┐  ┌─────────▼─────────┐  ┌─────────▼─────────┐   │
│ │SafeMultisigEVM│  │SafeMultisigEVM4337│  │  BitcoinMultisig  │   │
│ │  (Standard)   │  │  (ERC-4337)       │  │    (P2WSH)        │   │
│ └───────┬───────┘  └─────────┬─────────┘  └─────────┬─────────┘   │
│         │                    │                      │             │
│         │            ┌───────▼───────┐              │             │
│         │            │   Bundler     │              │             │
│         │            │  (Pimlico)    │              │             │
│         │            └───────┬───────┘              │             │
│         │                    │                      │             │
│         └────────────────────┼──────────────────────┘             │
│                              │                                    │
│                      ┌───────▼──────────┐                         │
│                      │ StorageAdapter   │                         │
│                      │   (Interface)    │                         │
│                      └──────┬───────────┘                         │
│                             │                                     │
│            ┌────────────────┼────────────────┬────────────┐       │
│            │                │                │            │       │
│      ┌─────▼──────┐   ┌─────▼──────┐   ┌─────▼──────┐     │       │
│      │ Autobase   │   │   Memory   │   │    API     │    ...      │
│      │ (P2P Sync) │   │  (Local)   │   │  (Server)  │  Custom     │
│      └─────┬──────┘   └────────────┘   └────────────┘             │
│            │                                                      │
│            │ Hyperswarm                                           │
│            ▼                                                      │
│      ┌─────────────┐                                              │
│      │ P2P Network │                                              │
│      └─────────────┘                                              │
└───────────────────────────────────────────────────────────────────┘
```

## Workflow

```
Alice (Bootstrap)           Bob (Peer)
     │                          │
     ├─ Create Autobase         │
     │                          │
     │◄────── Connect ──────────┤
     │                          │
     ├─ Register Bob as writer  │
     │  (ADD_WRITER operation)  │
     │                          │
     ├─ Create multisig ────────┤
     │  (saves to Autobase)     │
     │                          │
     │  ◄─── Sync via P2P ────► │
     │                          │
     ├─ Propose TX ──────────────┤
     │  (Alice signs)           │
     │                          │
     │  ◄─── Sync proposal ───► │
     │                          │
     │  ◄─── Bob signs ─────────┤
     │                          │
     │  ◄─── Sync signature ──► │
     │                          │
     ├─ Execute TX              │
     │  (broadcast to chain)    │
     └──────────────────────────┘
```