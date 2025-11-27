// Safe 4337 multisig with in-memory storage
// Demonstrates ERC-4337 account abstraction with paymaster support
//
// Features:
// - Counterfactual Safe deployment (deploy on first tx)
// - Gas payment in USDT/USDC via paymaster
// - All transactions go through bundler
// - Same propose → sign → execute workflow

import { SafeMultisigEVM4337 } from '../src/SafeMultisigEVM4337.js'
import { MemoryStorageAdapter } from '../src/storages/MemoryStorageAdapter.js'
import { ethers } from 'ethers'
import dotenv from 'dotenv'
dotenv.config()

const ALICE_SEED_PHRASE = process.env.ALICE_SEED_PHRASE
const BOB_SEED_PHRASE = process.env.BOB_SEED_PHRASE
const SEPOLIA_RPC = process.env.SEPOLIA_RPC

const BUNDLER_URL = process.env.BUNDLER_URL || `https://public.pimlico.io/v2/11155111/rpc`
const PAYMASTER_URL = process.env.PAYMASTER_URL || BUNDLER_URL
const PAYMASTER_ADDRESS = process.env.PAYMASTER_ADDRESS || '0x0000000000000039cd5e8aE05257CE51C473ddd1'
const USDC_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'

const RECIPIENT = '0x846dC48D4eAAF0cF53A42193d31861d866ff8d53'
const TRANSFER_AMOUNT = '1000000000000000' // 0.001 ETH

async function testSafe4337Multisig() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  Safe 4337 Multisig Test - Sepolia')
  console.log('  (ERC-4337 Account Abstraction)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  // Debug: Check env vars
  console.log('🔍 Debug: ALICE_SEED_PHRASE defined:', !!ALICE_SEED_PHRASE)
  console.log('🔍 Debug: BOB_SEED_PHRASE defined:', !!BOB_SEED_PHRASE)
  console.log('🔍 Debug: SEPOLIA_RPC defined:', !!SEPOLIA_RPC)
  
  if (!ALICE_SEED_PHRASE || !BOB_SEED_PHRASE) {
    throw new Error('Missing ALICE_SEED_PHRASE or BOB_SEED_PHRASE in .env')
  }
  if (!SEPOLIA_RPC) {
    throw new Error('Missing SEPOLIA_RPC in .env')
  }

  // ════════════════════════════════════
  // Step 1: Initialize Shared Memory Storage
  // ════════════════════════════════════
  console.log('\n💾 Step 1: Initialize Shared Memory Storage\n')

  const storage = new MemoryStorageAdapter()
  await storage.init()
  console.log('✅ Memory storage initialized (shared between Alice & Bob)\n')

  // ════════════════════════════════════
  // Step 2: Create Alice & Bob Managers
  // ════════════════════════════════════
  console.log('🏗️  Step 2: Create 4337 Managers\n')

  // Common config
  const config4337 = {
    provider: SEPOLIA_RPC,
    network: 'sepolia',
    bundlerUrl: BUNDLER_URL,
    paymasterUrl: BUNDLER_URL,
    // Uncomment to use paymaster for ERC-20 gas payment:
    // paymasterAddress: PAYMASTER_ADDRESS,
    // defaultGasToken: USDT_SEPOLIA,
    safeModulesVersion: '0.3.0', // EntryPoint v0.7
    storage
  }

  const aliceManager = new SafeMultisigEVM4337(ALICE_SEED_PHRASE, "0'/0/0", config4337)
  const bobManager = new SafeMultisigEVM4337(BOB_SEED_PHRASE, "0'/0/0", config4337)

  const aliceAddress = await aliceManager.getSignerAddress()
  const bobAddress = await bobManager.getSignerAddress()

  console.log('Alice EOA:', aliceAddress)
  console.log('Bob EOA:', bobAddress)

  // ════════════════════════════════════
  // Step 3: Create Safe (Counterfactual)
  // ════════════════════════════════════
  console.log('\n🚀 Step 3: Create Safe (Counterfactual)\n')

  // Check if we have an existing Safe address in env
  const existingSafe = process.env.SAFE_4337_ADDRESS

  let safeAddress
  if (existingSafe) {
    const provider = new ethers.providers.JsonRpcProvider(SEPOLIA_RPC)
    const code = await provider.getCode(existingSafe)
    const isDeployed = code !== '0x'

    if (isDeployed) {
      console.log('Importing deployed Safe:', existingSafe)
      await aliceManager.import(existingSafe)
      safeAddress = existingSafe
    } else {
      console.log('Safe not deployed yet, regenerating counterfactual address...')
      const result = await aliceManager.create([aliceAddress, bobAddress], 2)
      safeAddress = result.address
      
      if (safeAddress.toLowerCase() !== existingSafe.toLowerCase()) {
        console.log(`\n⚠️  Address changed! Old: ${existingSafe}`)
        console.log(`   This may happen if owners changed. Update .env:`)
        console.log(`   SAFE_4337_ADDRESS=${safeAddress}`)
      }
    }
  } else {
    const result = await aliceManager.create([aliceAddress, bobAddress], 2)
    safeAddress = result.address
    console.log('\n⚠️  Save this Safe address to .env as SAFE_4337_ADDRESS=' + safeAddress)
  }

  console.log('\n📬 Safe address:', safeAddress)

  await bobManager.import(safeAddress)
  console.log('✅ Bob connected to Safe')

  // ════════════════════════════════════
  // Step 4: Check Deployment Status & Balance
  // ════════════════════════════════════
  console.log('\n💰 Step 4: Check Deployment Status & Balance\n')

  const isDeployed = await aliceManager.isDeployed()
  console.log('Safe deployed:', isDeployed)

  const balance = await aliceManager.getBalance()
  const balanceEth = ethers.utils.formatEther(balance)
  console.log('Safe balance:', balanceEth, 'ETH')

  if (!isDeployed && balance.eq(0)) {
    console.log('\n⚠️  Safe needs funding before first transaction!')
    console.log('The Safe will be deployed automatically on the first transaction.')
    console.log('Send ETH to:', safeAddress)
    console.log('\nFor ERC-20 gas payment, also send USDT to the Safe.')
    console.log('Then run this script again.\n')
    
    aliceManager.dispose()
    bobManager.dispose()
    await storage.close()
    return
  }

  // ════════════════════════════════════
  // Step 5: Estimate Fee
  // ════════════════════════════════════
  console.log('\n📊 Step 5: Estimate Fee\n')

  try {
    const feeEstimate = await aliceManager.estimateFee({
      to: RECIPIENT,
      value: TRANSFER_AMOUNT
    })

    console.log('Estimated fee:', feeEstimate.feeFormatted, 'ETH')
    console.log('Gas details:', JSON.stringify(feeEstimate.gasDetails, null, 2))
  } catch (error) {
    console.log('Fee estimation failed:', error.message)
    console.log('(This might happen if Safe is not deployed yet)')
  }

  // ════════════════════════════════════
  // Step 6: Alice Proposes Transaction
  // ════════════════════════════════════
  console.log('\n📝 Step 6: Alice Proposes Transaction\n')

  let proposalId
  try {
    proposalId = await aliceManager.propose({
      to: RECIPIENT,
      value: TRANSFER_AMOUNT
    })

    console.log('Proposal ID:', proposalId)
    console.log('✅ Alice signed (1/2)')
  } catch (error) {
    console.error('Failed to create proposal:', error.message)
    
    // Cleanup
    aliceManager.dispose()
    bobManager.dispose()
    await storage.close()
    return
  }

  // ════════════════════════════════════
  // Step 7: Bob Signs
  // ════════════════════════════════════
  console.log('\n✍️  Step 7: Bob Signs\n')

  try {
    await bobManager.sign(proposalId)
    console.log('✅ Bob signed (2/2)')
  } catch (error) {
    console.error('Failed to sign:', error.message)
    
    aliceManager.dispose()
    bobManager.dispose()
    await storage.close()
    return
  }

  // ════════════════════════════════════
  // Step 8: Execute via Bundler
  // ════════════════════════════════════
  console.log('\n🚀 Step 8: Execute via Bundler\n')

  try {
    const result = await aliceManager.execute(proposalId)

    console.log('\n🎉 Transaction executed!')
    console.log('UserOp Hash:', result.userOpHash)
    if (result.txHash) {
      console.log('TX Hash:', result.txHash)
      console.log('View on Etherscan: https://sepolia.etherscan.io/tx/' + result.txHash)
    }
    console.log('Track UserOp: https://jiffyscan.xyz/userOpHash/' + result.userOpHash)
  } catch (error) {
    console.error('Failed to execute:', error.message)
    console.error(error.stack)
  }

  // ════════════════════════════════════
  // Step 9: Final Status
  // ════════════════════════════════════
  console.log('\n💰 Step 9: Final Status\n')

  const finalBalance = await aliceManager.getBalance()
  console.log('Safe balance:', ethers.utils.formatEther(finalBalance), 'ETH')

  const finalIsDeployed = await aliceManager.isDeployed()
  console.log('Safe deployed:', finalIsDeployed)

  // ════════════════════════════════════
  // Cleanup
  // ════════════════════════════════════
  console.log('\n🧹 Cleanup\n')
  
  aliceManager.dispose()
  bobManager.dispose()
  await storage.close()

  console.log('✅ Safe 4337 multisig test completed!')
  console.log('\n📊 Summary:')
  console.log('   - ERC-4337 Account Abstraction')
  console.log('   - Bundler-based execution')
  console.log('   - Counterfactual deployment')
  console.log('   - Same propose → sign → execute workflow')
}

// ════════════════════════════════════
// Alternative: Test with ERC-20 gas payment (USDC)
// ════════════════════════════════════

async function testWithPaymaster() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  Safe 4337 with Paymaster (USDC Gas)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  if (!ALICE_SEED_PHRASE || !BOB_SEED_PHRASE) {
    throw new Error('Missing ALICE_SEED_PHRASE or BOB_SEED_PHRASE in .env')
  }

  console.log('📦 Step 1: Setup\n')
  
  const storage = new MemoryStorageAdapter()
  await storage.init()

  const existingSafe = process.env.SAFE_4337_ADDRESS

  const config4337WithPaymaster = {
    provider: SEPOLIA_RPC,
    network: 'sepolia',
    bundlerUrl: BUNDLER_URL,
    
    paymasterUrl: PAYMASTER_URL,
    paymasterAddress: PAYMASTER_ADDRESS,
    paymasterTokenAddress: USDC_SEPOLIA,
    
    safeModulesVersion: '0.3.0',
    storage
  }

  console.log('Config:')
  console.log('  Bundler:', BUNDLER_URL.substring(0, 50) + '...')
  console.log('  Paymaster:', PAYMASTER_ADDRESS)
  console.log('  Gas Token: USDC', USDC_SEPOLIA)
  console.log('')

  console.log('👥 Step 2: Create 4337 Managers\n')
  
  const aliceManager = new SafeMultisigEVM4337(
    ALICE_SEED_PHRASE,
    "0'/0/0",
    config4337WithPaymaster
  )

  const bobManager = new SafeMultisigEVM4337(
    BOB_SEED_PHRASE,
    "0'/0/0",
    config4337WithPaymaster
  )

  const aliceAddress = await aliceManager.getSignerAddress()
  const bobAddress = await bobManager.getSignerAddress()
  console.log('Alice EOA:', aliceAddress)
  console.log('Bob EOA:', bobAddress)

  try {
    console.log('\n🚀 Step 3: Create/Import Safe\n')
    
    if (existingSafe) {
      console.log(`Using existing Safe: ${existingSafe}`)
      await aliceManager.import(existingSafe)
      await bobManager.import(existingSafe)
    } else {
      console.log('Creating new Safe 4337 multisig: 2-of-2')
      const result = await aliceManager.create([aliceAddress, bobAddress], 2)
      console.log(`Safe address: ${result.address}`)
      await bobManager.import(result.address)
    }

    const safeAddress = aliceManager.address
    console.log(`\n📬 Safe address: ${safeAddress}`)

    console.log('\n💰 Step 4: Check USDC Balance\n')
    
    const provider = new ethers.providers.JsonRpcProvider(SEPOLIA_RPC)
    const usdcContract = new ethers.Contract(
      USDC_SEPOLIA,
      ['function balanceOf(address) view returns (uint256)', 'function decimals() view returns (uint8)'],
      provider
    )
    
    const [usdcBalance, decimals] = await Promise.all([
      usdcContract.balanceOf(safeAddress),
      usdcContract.decimals()
    ])
    
    const usdcFormatted = ethers.utils.formatUnits(usdcBalance, decimals)
    console.log(`Safe USDC balance: ${usdcFormatted} USDC`)
    
    if (usdcBalance.isZero()) {
      console.log('\n⚠️  Safe has no USDC!')
      console.log('To test paymaster, send USDC to the Safe address:')
      console.log(`   Safe: ${safeAddress}`)
      console.log(`   USDC (Sepolia): ${USDC_SEPOLIA}`)
      console.log('\nYou can get testnet USDC from:')
      console.log('   https://faucet.circle.com/')
      console.log('\nSkipping paymaster test...')
      return
    }

    console.log('\n📊 Step 5: Estimate Fee (USDC)\n')
    
    const recipient = aliceAddress
    const transferAmount = '1000000000000000' // 0.001 ETH
    
    const testTx = {
      to: recipient,
      value: transferAmount,
      data: '0x'
    }
    
    console.log(`Test transaction: Send 0.001 ETH to ${recipient}`)
    
    const feeEstimate = await aliceManager.estimateFee(testTx)
    console.log('Estimated fee:', feeEstimate.totalFee, 'ETH equivalent')
    console.log('(Paymaster will convert this to USDC automatically)')

    console.log('\n📝 Step 6: Alice Proposes Transaction\n')
    
    // For first transaction, we need to approve the paymaster to spend USDC
    // The SDK will include the approval in the same batch
    // We approve a generous amount to avoid needing approvals on every tx
    const amountToApprove = ethers.utils.parseUnits('10', 6) // 10 USDC
    
    const proposalId = await aliceManager.propose(testTx, {
      amountToApprove
    })
    console.log('Proposal ID:', proposalId)
    console.log('✅ Alice signed (1/2)')

    console.log('\n✍️  Step 7: Bob Signs\n')
    
    await bobManager.sign(proposalId)
    console.log('✅ Bob signed (2/2)')

    console.log('\n🚀 Step 8: Execute via Bundler (USDC Gas)\n')
    
    const result = await aliceManager.execute(proposalId)
    
    console.log('\n🎉 Transaction executed!')
    console.log('UserOp Hash:', result.userOpHash)
    console.log('TX Hash:', result.txHash)
    console.log('\n💡 Gas was paid in USDC, not ETH!')

    console.log('\n💰 Step 9: Final USDC Balance\n')
    
    // Wait a bit for the balance to update
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    const finalUsdcBalance = await usdcContract.balanceOf(safeAddress)
    const finalUsdcFormatted = ethers.utils.formatUnits(finalUsdcBalance, decimals)
    const usdcSpent = ethers.utils.formatUnits(usdcBalance.sub(finalUsdcBalance), decimals)
    
    console.log(`USDC before: ${usdcFormatted}`)
    console.log(`USDC after:  ${finalUsdcFormatted}`)
    console.log(`USDC spent on gas: ${usdcSpent}`)
    
    if (usdcBalance.eq(finalUsdcBalance)) {
      console.log('\n💡 Note: USDC balance unchanged - this can happen if:')
      console.log('   - The paymaster sponsored the tx (free)')
      console.log('   - Balance not yet updated (check Etherscan)')
    }

  } finally {
    console.log('\n🧹 Cleanup')
    aliceManager.dispose()
    bobManager.dispose()
    await storage.close()
  }

  console.log('\n✅ Paymaster test completed!')
  console.log('📊 Summary:')
  console.log('   - Gas paid in USDC (not ETH)')
  console.log('   - Pimlico ERC-20 Paymaster')
  console.log('   - Same workflow: propose → sign → execute')
}

// ════════════════════════════════════
// Run tests
// ════════════════════════════════════

// Check command line args
const args = process.argv.slice(2)
const usePaymaster = args.includes('--paymaster') || args.includes('-p')

if (usePaymaster) {
  testWithPaymaster().catch(err => {
    console.error('\n❌ Error:', err.message)
    console.error(err.stack)
    process.exit(1)
  })
} else {
  // Run main test (ETH gas)
  testSafe4337Multisig().catch(err => {
    console.error('\n❌ Error:', err.message)
    console.error(err.stack)
    process.exit(1)
  })
}