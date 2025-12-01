// Safe 4337 Multisig with Safe API Kit
//
// Features:
// - SafeOperations stored on Safe's servers (no local storage needed)
// - Alice and Bob can be on different machines
// - Paymaster support for ERC-20 gas payment (zero ETH required!)
// - Compatible with Safe{Wallet} web UI
//
// Usage:
//   node examples/example-safe-api-4337.js                    # Test with existing Safe (ETH gas)
//   node examples/example-safe-api-4337.js --create           # Create new Safe (ETH gas)
//   node examples/example-safe-api-4337.js --create --gasless # Create new Safe (USDC gas) ← DIFFERENT ADDRESS!
//   node examples/example-safe-api-4337.js --gasless          # Test gasless: Deploy + Approve + TX
//
// ⚠️  IMPORTANT: ETH and Gasless Safes have DIFFERENT addresses!
//     Safe SDK configures differently when paymasterOptions is present.

import { SafeMultisigEVM4337Api } from '../src/SafeMultisigEVM4337Api.js'
import { ethers } from 'ethers'
import dotenv from 'dotenv'
dotenv.config()

// ════════════════════════════════════════════════════════════════════════════
// Configuration
// ════════════════════════════════════════════════════════════════════════════

const ALICE_SEED_PHRASE = process.env.ALICE_SEED_PHRASE
const BOB_SEED_PHRASE = process.env.BOB_SEED_PHRASE
const SEPOLIA_RPC = process.env.SEPOLIA_RPC
const SAFE_ADDRESS = process.env.SAFE_4337_ADDRESS

const ALICE_PATH = "0'/0/0"
const BOB_PATH = "0'/0/0"

// Pimlico
const PIMLICO_API_KEY = process.env.PIMLICO_API_KEY || ''
const BUNDLER_URL = process.env.BUNDLER_URL || `https://api.pimlico.io/v2/11155111/rpc?apikey=${PIMLICO_API_KEY}`
const PAYMASTER_URL = process.env.PAYMASTER_URL || BUNDLER_URL

// Tokens & Contracts
const USDC_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'
const PIMLICO_ERC20_PAYMASTER = '0x6666666666667849c56f2850848ce1c4da65c68b'

// EntryPoint v0.6 (recommended for Safe API compatibility)
const SAFE_MODULES_VERSION = '0.2.0'

// ════════════════════════════════════════════════════════════════════════════
// Create New Safe
// ════════════════════════════════════════════════════════════════════════════

async function createNewSafe(usePaymaster = false) {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  Create New Safe 4337 ${usePaymaster ? '(Gasless/USDC)' : '(ETH gas)'}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  if (!ALICE_SEED_PHRASE || !BOB_SEED_PHRASE) {
    throw new Error('Missing ALICE_SEED_PHRASE or BOB_SEED_PHRASE in .env')
  }

  const config = {
    provider: SEPOLIA_RPC,
    chainId: 11155111n,
    bundlerUrl: BUNDLER_URL,
    safeModulesVersion: SAFE_MODULES_VERSION,
    safeApiKey: process.env.SAFE_API_KEY
  }

  if (usePaymaster) {
    const approvalAmount = ethers.utils.parseUnits('1000000', 6)
    config.paymasterOptions = {
      paymasterUrl: PAYMASTER_URL,
      paymasterAddress: PIMLICO_ERC20_PAYMASTER,
      paymasterTokenAddress: USDC_SEPOLIA,
      amountToApprove: BigInt(approvalAmount.toString())
    }
    console.log(`Paymaster: USDC (${ethers.utils.formatUnits(approvalAmount, 6)} approval)\n`)
  }

  const alice = new SafeMultisigEVM4337Api(ALICE_SEED_PHRASE, ALICE_PATH, config)
  const bob = new SafeMultisigEVM4337Api(BOB_SEED_PHRASE, BOB_PATH, config)

  const aliceAddress = await alice.getSignerAddress()
  const bobAddress = await bob.getSignerAddress()
  console.log(`Alice: ${aliceAddress}`)
  console.log(`Bob: ${bobAddress}`)

  const owners = [aliceAddress, bobAddress]
  const threshold = 2
  const saltNonce = 123456

  console.log(`\nCreating ${threshold}-of-${owners.length} Safe...\n`)
  const result = await alice.create(owners, threshold, saltNonce)

  console.log('\n✅ Safe created (counterfactual)')
  console.log(`   Address: ${result.address}`)
  console.log(`   Deployed: ${result.isDeployed}`)
  console.log(`   Mode: ${usePaymaster ? 'Gasless (USDC)' : 'ETH gas'}`)
  
  if (!result.isDeployed) {
    console.log('\n📝 Safe will be deployed on first transaction')
    if (usePaymaster) {
      console.log(`   Fund with USDC: https://faucet.circle.com/`)
    } else {
      console.log('   Fund with ETH before executing transactions')
    }
  }

  const envVar = usePaymaster ? 'SAFE_4337_GASLESS_ADDRESS' : 'SAFE_4337_ADDRESS'
  console.log(`\n💡 Add to .env:\n   ${envVar}=${result.address}`)

  alice.dispose()
  bob.dispose()
  return result.address
}

// ════════════════════════════════════════════════════════════════════════════
// Test: ETH Gas Payment
// ════════════════════════════════════════════════════════════════════════════

async function testWithETH() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  Safe 4337 + API Kit (ETH gas)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  if (!ALICE_SEED_PHRASE || !BOB_SEED_PHRASE) throw new Error('Missing seed phrases in .env')
  if (!SEPOLIA_RPC) throw new Error('Missing SEPOLIA_RPC in .env')
  if (!SAFE_ADDRESS) throw new Error('Missing SAFE_4337_ADDRESS in .env')

  const config = {
    provider: SEPOLIA_RPC,
    chainId: 11155111n,
    bundlerUrl: BUNDLER_URL,
    safeModulesVersion: SAFE_MODULES_VERSION,
    safeApiKey: process.env.SAFE_API_KEY
  }

  // Initialize
  const alice = new SafeMultisigEVM4337Api(ALICE_SEED_PHRASE, ALICE_PATH, config)
  const bob = new SafeMultisigEVM4337Api(BOB_SEED_PHRASE, BOB_PATH, config)

  const aliceAddress = await alice.getSignerAddress()
  const bobAddress = await bob.getSignerAddress()
  console.log(`Alice: ${aliceAddress}`)
  console.log(`Bob: ${bobAddress}`)

  // Import Safe
  const predictedConfig = { owners: [aliceAddress, bobAddress], threshold: 2, saltNonce: 123456 }
  await alice.import(SAFE_ADDRESS, predictedConfig)
  await bob.import(SAFE_ADDRESS, predictedConfig)
  console.log(`\nSafe: ${alice.getAddress()}`)

  // Check status
  const isDeployed = await alice.isDeployed()
  const balance = await alice.getBalance()
  console.log(`Deployed: ${isDeployed}`)
  console.log(`Balance: ${ethers.utils.formatEther(balance)} ETH`)

  if (!isDeployed && balance === 0n) {
    console.log(`\n⚠️ Fund Safe with ETH: ${SAFE_ADDRESS}`)
    alice.dispose()
    bob.dispose()
    return
  }

  // Propose → Sign → Execute
  console.log('\n📤 Alice proposes...')
  const safeOpHash = await alice.propose({ to: aliceAddress, value: '0', data: '0x' })
  console.log(`SafeOp: ${safeOpHash}`)

  console.log('\n✍️ Bob signs...')
  await bob.signProposal(safeOpHash)

  console.log('\n🚀 Executing...')
  const result = await alice.execute(safeOpHash)
  console.log(`\n🎉 TX Hash: ${result.txHash}`)
  console.log(`   https://sepolia.etherscan.io/tx/${result.txHash}`)

  alice.dispose()
  bob.dispose()
}

// ════════════════════════════════════════════════════════════════════════════
// Test: Gasless (USDC Gas Payment)
// ════════════════════════════════════════════════════════════════════════════

async function testGasless() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  Gasless Safe (USDC gas) - Zero ETH required!')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  if (!ALICE_SEED_PHRASE || !BOB_SEED_PHRASE) throw new Error('Missing seed phrases in .env')

  const approvalAmount = ethers.utils.parseUnits('1000000', 6)

  const config = {
    provider: SEPOLIA_RPC,
    chainId: 11155111n,
    bundlerUrl: BUNDLER_URL,
    safeModulesVersion: SAFE_MODULES_VERSION,
    safeApiKey: process.env.SAFE_API_KEY,
    paymasterOptions: {
      paymasterUrl: PAYMASTER_URL,
      paymasterAddress: PIMLICO_ERC20_PAYMASTER,
      paymasterTokenAddress: USDC_SEPOLIA,
      amountToApprove: BigInt(approvalAmount.toString())
    }
  }

  const alice = new SafeMultisigEVM4337Api(ALICE_SEED_PHRASE, ALICE_PATH, config)
  const bob = new SafeMultisigEVM4337Api(BOB_SEED_PHRASE, BOB_PATH, config)

  const aliceAddress = await alice.getSignerAddress()
  const bobAddress = await bob.getSignerAddress()
  console.log(`Alice: ${aliceAddress}`)
  console.log(`Bob: ${bobAddress}`)

  // Create/predict address
  const owners = [aliceAddress, bobAddress]
  const threshold = 2
  const saltNonce = 123456

  const createResult = await alice.create(owners, threshold, saltNonce)
  const safeAddress = createResult.address
  console.log(`\nSafe: ${safeAddress}`)
  console.log(`Deployed: ${createResult.isDeployed}`)

  // Note about different addresses
  if (SAFE_ADDRESS && SAFE_ADDRESS.toLowerCase() !== safeAddress.toLowerCase()) {
    console.log(`\n📝 Gasless Safe address differs from ETH Safe (expected)`)
    console.log(`   ETH Safe:     ${SAFE_ADDRESS}`)
    console.log(`   Gasless Safe: ${safeAddress}`)
  }

  // Bob imports
  await bob.import(safeAddress, { owners, threshold, saltNonce })

  // Check balances
  const ethBalance = await alice.getBalance()
  const usdcBalance = await alice.getBalance(USDC_SEPOLIA)
  console.log(`\nETH: ${ethers.utils.formatEther(ethBalance)}`)
  console.log(`USDC: ${ethers.utils.formatUnits(usdcBalance, 6)}`)

  if (usdcBalance === 0n) {
    console.log(`\n⚠️ Fund Safe with USDC:`)
    console.log(`   1. Get USDC: https://faucet.circle.com/`)
    console.log(`   2. Send to: ${safeAddress}`)
    console.log(`   3. Run again: node examples/example-safe-api-4337.js --gasless`)
    alice.dispose()
    bob.dispose()
    return
  }

  // Propose → Sign → Execute
  console.log('\n📤 Alice proposes...')
  if (!createResult.isDeployed) {
    console.log('   (Will deploy Safe + approve paymaster + execute tx)')
  }
  const safeOpHash = await alice.propose({ to: aliceAddress, value: '0', data: '0x' })
  console.log(`SafeOp: ${safeOpHash}`)

  console.log('\n✍️ Bob signs...')
  await bob.signProposal(safeOpHash)

  console.log('\n🚀 Executing...')
  const result = await alice.execute(safeOpHash)
  console.log(`\n🎉 TX Hash: ${result.txHash}`)

  // Verify
  const provider = new ethers.providers.JsonRpcProvider(SEPOLIA_RPC)
  const code = await provider.getCode(safeAddress)
  const erc20Abi = ['function allowance(address,address) view returns (uint256)']
  const usdc = new ethers.Contract(USDC_SEPOLIA, erc20Abi, provider)
  const allowance = await usdc.allowance(safeAddress, PIMLICO_ERC20_PAYMASTER)

  console.log(`\n✅ Results:`)
  console.log(`   Safe deployed: ${code !== '0x' ? 'YES' : 'NO'}`)
  console.log(`   Paymaster approved: ${allowance.gt(0) ? 'YES' : 'NO'}`)
  console.log(`   USDC spent: ${ethers.utils.formatUnits(usdcBalance - await alice.getBalance(USDC_SEPOLIA), 6)}`)

  alice.dispose()
  bob.dispose()
}

// ════════════════════════════════════════════════════════════════════════════
// Run
// ════════════════════════════════════════════════════════════════════════════

const args = process.argv.slice(2)
const createSafe = args.includes('--create') || args.includes('-c')
const useGasless = args.includes('--gasless') || args.includes('-g')

if (createSafe) {
  createNewSafe(useGasless).catch(err => {
    console.error('\n❌ Error:', err.message)
    process.exit(1)
  })
} else if (useGasless) {
  testGasless().catch(err => {
    console.error('\n❌ Error:', err.message)
    process.exit(1)
  })
} else {
  testWithETH().catch(err => {
    console.error('\n❌ Error:', err.message)
    process.exit(1)
  })
}