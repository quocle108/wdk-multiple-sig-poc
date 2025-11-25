// Example: Safe Owner & Threshold Management
// Demonstrates adding/removing owners and changing threshold

import { SafeMultisigEVM } from '../src/SafeMultisigEVM.js'
import { MemoryStorageAdapter } from '../src/storages/MemoryStorageAdapter.js'
import { ethers } from 'ethers'
import dotenv from 'dotenv'
dotenv.config()

const ALICE_SEED_PHRASE = process.env.ALICE_SEED_PHRASE
const BOB_SEED_PHRASE = process.env.BOB_SEED_PHRASE
const CHARLIE_SEED_PHRASE = process.env.CHARLIE_SEED_PHRASE || "test walk nut penalty hip pave soap entry language right filter choice"
const SEPOLIA_RPC = process.env.SEPOLIA_RPC
const SAFE_ADDRESS = process.env.SAFE_ADDRESS

async function testOwnerManagement() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  Safe Owner & Threshold Management')
  console.log('  (Memory Storage)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  if (!SAFE_ADDRESS) {
    console.error('❌ SAFE_ADDRESS not set in .env')
    console.log('Run example-evm-memory.js first to create a Safe')
    return
  }

  // ════════════════════════════════════════
  // Step 1: Initialize Storage & Managers
  // ════════════════════════════════════════
  console.log('💾 Step 1: Initialize Storage & Managers\n')

  const storage = new MemoryStorageAdapter()
  await storage.init()

  const aliceManager = new SafeMultisigEVM(ALICE_SEED_PHRASE, "0'/0/0", {
    provider: SEPOLIA_RPC,
    network: 'sepolia',
    storage
  })

  const bobManager = new SafeMultisigEVM(BOB_SEED_PHRASE, "0'/0/0", {
    provider: SEPOLIA_RPC,
    network: 'sepolia',
    storage
  })

  const charlieManager = new SafeMultisigEVM(CHARLIE_SEED_PHRASE, "0'/0/0", {
    provider: SEPOLIA_RPC,
    network: 'sepolia',
    storage
  })

  const aliceAddress = await aliceManager.getSignerAddress()
  const bobAddress = await bobManager.getSignerAddress()
  const charlieAddress = await charlieManager.getSignerAddress()

  console.log('Alice:', aliceAddress)
  console.log('Bob:', bobAddress)
  console.log('Charlie:', charlieAddress)
  console.log()

  // ════════════════════════════════════════
  // Step 2: Import Existing Safe
  // ════════════════════════════════════════
  console.log('🔍 Step 2: Import Existing Safe\n')

  await aliceManager.import(SAFE_ADDRESS)
  await bobManager.import(SAFE_ADDRESS)

  console.log('Safe address:', SAFE_ADDRESS)
  console.log('Current owners:', aliceManager.owners.length)
  console.log('Current threshold:', aliceManager.threshold)
  console.log()

  // ════════════════════════════════════════
  // Step 3: Add Charlie as Owner (2-of-3)
  // ════════════════════════════════════════
  console.log('👥 Step 3: Add Charlie as Owner\n')

  // Alice proposes to add Charlie, keeping threshold at 2
  const addOwnerProposalId = await aliceManager.addOwner(charlieAddress, 2)
  console.log('✅ Alice signed add owner proposal')

  // Bob signs
  await bobManager.sign(addOwnerProposalId)
  console.log('✅ Bob signed (2/2)')

  // Alice executes
  const addResult = await aliceManager.execute(addOwnerProposalId)
  console.log('✅ Charlie added as owner!')
  console.log('TX:', addResult.txHash)
  console.log()

  // Wait for transaction to be mined
  await new Promise(resolve => setTimeout(resolve, 5000))

  // Refresh Safe info for all managers
  await aliceManager.import(SAFE_ADDRESS)
  await bobManager.import(SAFE_ADDRESS)
  await charlieManager.import(SAFE_ADDRESS)

  console.log('📊 New configuration:')
  console.log('   Owners:', aliceManager.owners.length)
  console.log('   Threshold:', aliceManager.threshold)
  console.log()

  // ════════════════════════════════════════
  // Step 4: Increase Threshold to 3-of-3
  // ════════════════════════════════════════
  console.log('🔐 Step 4: Increase Threshold to 3-of-3\n')

  // Alice proposes threshold change
  const thresholdProposalId = await aliceManager.changeThreshold(3)
  console.log('✅ Alice signed threshold change')

  // Bob signs
  await bobManager.sign(thresholdProposalId)
  console.log('✅ Bob signed (2/2, still under old threshold)')

  // Execute
  const thresholdTx = await aliceManager.execute(thresholdProposalId)
  console.log('✅ Threshold changed to 3!')
  console.log('TX:', thresholdTx.txHash)
  console.log()

  // Wait for transaction
  await new Promise(resolve => setTimeout(resolve, 5000))

  // Refresh Safe info
  await aliceManager.import(SAFE_ADDRESS)
  await bobManager.import(SAFE_ADDRESS)
  await charlieManager.import(SAFE_ADDRESS)

  console.log('📊 New configuration:')
  console.log('   Owners:', aliceManager.owners.length)
  console.log('   Threshold:', aliceManager.threshold)
  console.log()

  // ════════════════════════════════════════
  // Step 5: Test Transaction with 3-of-3
  // ════════════════════════════════════════
  console.log('💸 Step 5: Test Transaction with 3-of-3 Threshold\n')

  const testTxProposalId = await aliceManager.propose({
    to: ethers.constants.AddressZero,
    value: '0'
  })
  console.log('✅ Alice signed (1/3)')

  await bobManager.sign(testTxProposalId)
  console.log('✅ Bob signed (2/3)')

  await charlieManager.sign(testTxProposalId)
  console.log('✅ Charlie signed (3/3) - threshold met!')

  const testTx = await aliceManager.execute(testTxProposalId)
  console.log('✅ Transaction executed!')
  console.log('TX:', testTx.txHash)
  console.log()

  // ════════════════════════════════════════
  // Step 6: Remove Charlie (back to 2-of-2)
  // ════════════════════════════════════════
  console.log('👋 Step 6: Remove Charlie\n')

  // Alice proposes to remove Charlie, set threshold back to 2
  const removeProposalId = await aliceManager.removeOwner(charlieAddress, 2)
  console.log('✅ Alice signed remove owner (1/3)')

  await bobManager.sign(removeProposalId)
  console.log('✅ Bob signed (2/3)')

  await charlieManager.sign(removeProposalId)
  console.log('✅ Charlie signed (3/3) - Charlie signs their own removal!')

  const removeTx = await aliceManager.execute(removeProposalId)
  console.log('✅ Charlie removed!')
  console.log('TX:', removeTx.txHash)
  console.log()

  // Wait for transaction
  await new Promise(resolve => setTimeout(resolve, 5000))

  // Refresh Safe info
  await aliceManager.import(SAFE_ADDRESS)

  console.log('📊 Final configuration:')
  console.log('   Owners:', aliceManager.owners.length)
  console.log('   Threshold:', aliceManager.threshold)
  console.log()

  // ════════════════════════════════════════
  // Cleanup
  // ════════════════════════════════════════
  console.log('🧹 Cleanup\n')
  
  aliceManager.dispose()
  bobManager.dispose()
  charlieManager.dispose()
  await storage.close()

  console.log('✅ Owner & threshold management test completed!')
  console.log('\n📊 Summary:')
  console.log('   ✓ Added owner (2-of-2 → 2-of-3)')
  console.log('   ✓ Increased threshold (2-of-3 → 3-of-3)')
  console.log('   ✓ Tested transaction with 3 signatures')
  console.log('   ✓ Removed owner (3-of-3 → 2-of-2)')
  console.log('   ✓ Back to original configuration')
}

testOwnerManagement().catch(err => {
  console.error('\n❌ Error:', err.message)
  console.error(err.stack)
  process.exit(1)
})