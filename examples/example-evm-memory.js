// Safe multisig with in-memory storage
// Simulates Alice and Bob in a single script with shared memory storage
import { SafeMultisigEVM } from '../src/SafeMultisigEVM.js'
import { MemoryStorageAdapter } from '../src/storages/MemoryStorageAdapter.js'
import { ethers } from 'ethers'
import dotenv from 'dotenv'
dotenv.config()

const ALICE_SEED_PHRASE = process.env.ALICE_SEED_PHRASE
const BOB_SEED_PHRASE = process.env.BOB_SEED_PHRASE
const SEPOLIA_RPC = process.env.SEPOLIA_RPC

// Recipient address for test transfer
const RECIPIENT = '0x0000000000000000000000000000000000000001'
const TRANSFER_AMOUNT = '1000000000000000' // 0.001 ETH in wei

async function testEvmMultisigMemory() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  Safe Multisig Test - Sepolia')
  console.log('  (In-Memory Storage - Fast & Simple)')
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

  // Single shared storage for both Alice and Bob
  const storage = new MemoryStorageAdapter()
  await storage.init()
  console.log('✅ Memory storage initialized (shared between Alice & Bob)\n')

  // ════════════════════════════════════
  // Step 2: Create Alice & Bob Managers
  // ════════════════════════════════════
  console.log('🏗️  Step 2: Create Managers\n')

  const aliceManager = new SafeMultisigEVM(ALICE_SEED_PHRASE, "0'/0/0", {
    provider: SEPOLIA_RPC,
    network: 'sepolia',
    storage  // Both share the same storage
  })

  const bobManager = new SafeMultisigEVM(BOB_SEED_PHRASE, "0'/0/0", {
    provider: SEPOLIA_RPC,
    network: 'sepolia',
    storage  // Both share the same storage
  })

  const aliceAddress = await aliceManager.getSignerAddress()
  const bobAddress = await bobManager.getSignerAddress()

  console.log('Alice:', aliceAddress)
  console.log('Bob:', bobAddress)

  // ════════════════════════════════════
  // Step 3: Create or Import Safe
  // ════════════════════════════════════
  console.log('\n🚀 Step 3: Create/Import Safe\n')

  // Check if we already have a Safe deployed (to avoid deploying multiple times)
  const existingSafe = process.env.SAFE_ADDRESS

  let safeAddress
  if (existingSafe) {
    console.log('Importing existing Safe:', existingSafe)
    await aliceManager.import(existingSafe)
    safeAddress = existingSafe
  } else {
    const result = await aliceManager.create([aliceAddress, bobAddress], 2)
    safeAddress = result.address
    console.log('\n⚠️  Save this Safe address to .env as SAFE_ADDRESS=' + safeAddress)
  }

  console.log('\n📬 Safe address:', safeAddress)

  // Bob also imports the Safe (from shared storage)
  await bobManager.import(safeAddress)
  console.log('✅ Bob connected to Safe')

  // ════════════════════════════════════
  // Step 4: Check Safe Balance
  // ════════════════════════════════════
  console.log('\n💰 Step 4: Check Safe Balance\n')

  const balance = await aliceManager.getBalance()
  const balanceEth = ethers.utils.formatEther(balance)
  console.log('Safe balance:', balanceEth, 'ETH')

  if (balance.lt(ethers.BigNumber.from(TRANSFER_AMOUNT).mul(2))) {
    console.log('\n⚠️  Safe needs funding!')
    console.log('Send at least 0.002 ETH to:', safeAddress)
    console.log('Then run this script again.\n')
    
    // Cleanup
    aliceManager.dispose()
    bobManager.dispose()
    await storage.close()
    return
  }

  // ════════════════════════════════════
  // Step 5: Alice Proposes Transaction
  // ════════════════════════════════════
  console.log('\n📝 Step 5: Alice Proposes Transaction\n')

  const proposalId = await aliceManager.propose({
    to: RECIPIENT,
    value: TRANSFER_AMOUNT
  })

  console.log('Proposal ID:', proposalId)
  console.log('✅ Alice signed (1/2)')

  // ════════════════════════════════════
  // Step 6: Bob Signs (immediately available from shared storage)
  // ════════════════════════════════════
  console.log('\n✍️  Step 6: Bob Signs\n')

  await bobManager.sign(proposalId)
  console.log('✅ Bob signed (2/2)')

  // ════════════════════════════════════
  // Step 7: Execute the Transaction
  // ════════════════════════════════════
  console.log('\n🚀 Step 7: Execute Transaction\n')

  const result = await aliceManager.execute(proposalId)

  console.log('🎉 Transaction executed!')
  console.log('TX Hash:', result.txHash)
  console.log('View on Etherscan: https://sepolia.etherscan.io/tx/' + result.txHash)

  // ════════════════════════════════════
  // Step 8: Check Final Balance
  // ════════════════════════════════════
  console.log('\n💰 Step 8: Final Balance\n')

  const finalBalance = await aliceManager.getBalance()
  console.log('Safe balance:', ethers.utils.formatEther(finalBalance), 'ETH')

  // ════════════════════════════════════
  // Step 9: Query Storage
  // ════════════════════════════════════
  console.log('\n📊 Step 9: Query Storage\n')

  // List Alice's multisigs
  const aliceMultisigs = await storage.listMultisigsByUser(aliceAddress)
  console.log(`Alice's multisigs: ${aliceMultisigs.length}`)

  // List Bob's proposals
  const bobProposals = await storage.listProposalsByUser(bobAddress)
  console.log(`Bob's proposals: ${bobProposals.length}`)

  // List pending proposals
  const pendingProposals = await storage.listProposals(safeAddress, { status: 'pending' })
  console.log(`Pending proposals: ${pendingProposals.length}`)

  // List executed proposals
  const executedProposals = await storage.listProposals(safeAddress, { status: 'executed' })
  console.log(`Executed proposals: ${executedProposals.length}`)

  // Export proposal for manual sharing
  console.log('\n📤 Export Example\n')
  const proposalJson = await storage.exportProposal(proposalId)
  console.log('Proposal can be exported as JSON:')
  console.log(proposalJson.substring(0, 200) + '...')

  // ════════════════════════════════════
  // Cleanup
  // ════════════════════════════════════
  console.log('\n🧹 Cleanup\n')
  
  aliceManager.dispose()
  bobManager.dispose()
  await storage.close()

  console.log('✅ Safe multisig test completed!')
  console.log('\n📊 Summary:')
  console.log('   - Shared in-memory storage')
  console.log('   - No P2P networking needed')
  console.log('   - Perfect for testing')
  console.log('   - Data exists only during script execution')
}

testEvmMultisigMemory().catch(err => {
  console.error('\n❌ Error:', err.message)
  console.error(err.stack)
  process.exit(1)
})