// Full multisig flow: Create → Fund → Propose → Sign → Execute
// Simulates two separate nodes (Alice and Bob) in a single script

import { SafeMultisigEVM } from '../src/SafeMultisigEVM.js'
import { AutobaseStorageAdapter } from '../src/storages/AutobaseStorageAdapter.js'
import { ethers } from 'ethers'
import dotenv from 'dotenv'
dotenv.config()

const ALICE_SEED_PHRASE = process.env.ALICE_SEED_PHRASE
const BOB_SEED_PHRASE = process.env.BOB_SEED_PHRASE
const SEPOLIA_RPC = process.env.SEPOLIA_RPC

// Recipient address for test transfer
const RECIPIENT = '0x0000000000000000000000000000000000000001'
const TRANSFER_AMOUNT = '1000000000000000' // 0.001 ETH in wei

async function fullFlow() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  Full Multisig Flow Test - Sepolia')
  console.log('  (Alice and Bob as separate P2P nodes)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  // Debug: Check env vars
  console.log('🔍 Debug: ALICE_SEED_PHRASE defined:', !!ALICE_SEED_PHRASE)
  console.log('🔍 Debug: BOB_SEED_PHRASE defined:', !!BOB_SEED_PHRASE)
  console.log('🔍 Debug: SEPOLIA_RPC defined:', !!SEPOLIA_RPC)
  
  if (!ALICE_SEED_PHRASE || !BOB_SEED_PHRASE) {
    throw new Error('Missing ALICE_SEED_PHRASE or BOB_SEED_PHRASE in .env')
  }

  // ════════════════════════════════════
  // Step 1: Initialize Separate Storage Nodes
  // ════════════════════════════════════
  console.log('\n💾 Step 1: Initialize Separate Storage Nodes\n')

  // Alice's storage node
  const aliceStorage = new AutobaseStorageAdapter({
    storagePath: './evm-test-data/alice',
    nodeId: 'alice'
  })
  await aliceStorage.init()
  console.log('✅ Alice storage initialized')

  // Bob's storage node (separate directory, connects to Alice's Autobase)
  const bobStorage = new AutobaseStorageAdapter({
    storagePath: './evm-test-data/bob',
    nodeId: 'bob',
    bootstrapKey: aliceStorage.base.key  // Connect to Alice's Autobase
  })
  await bobStorage.init()
  console.log('✅ Bob storage initialized')
  
  console.log('⏳ Waiting for P2P connection...')
  await new Promise(resolve => setTimeout(resolve, 3000))
  console.log('✅ P2P nodes connected')

  // ════════════════════════════════════
  // Step 2: Create Alice & Bob Managers
  // ════════════════════════════════════
  console.log('\n🏗️  Step 2: Create Managers\n')

  const aliceManager = new SafeMultisigEVM(ALICE_SEED_PHRASE, "0'/0/0", {
    provider: SEPOLIA_RPC,
    network: 'sepolia',
    storage: aliceStorage  // Alice uses her own storage node
  })

  const bobManager = new SafeMultisigEVM(BOB_SEED_PHRASE, "0'/0/0", {
    provider: SEPOLIA_RPC,
    network: 'sepolia',
    storage: bobStorage  // Bob uses his own storage node
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

  // Bob also imports the Safe (from his own storage node)
  await bobManager.import(safeAddress)
  console.log('✅ Bob connected to Safe')

  // Wait for P2P sync
  console.log('⏳ Syncing Safe info to Bob\'s node...')
  await new Promise(resolve => setTimeout(resolve, 2000))

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
    await aliceStorage.close()
    await bobStorage.close()
    return
  }

  // ════════════════════════════════════
  // Step 5: Alice Proposes Transaction
  // ════════════════════════════════════
  console.log('\n📝 Step 5: Alice Proposes Transaction (on her node)\n')

  const proposalId = await aliceManager.propose({
    to: RECIPIENT,
    value: TRANSFER_AMOUNT
  })

  console.log('Proposal ID:', proposalId)
  console.log('✅ Alice signed (1/2)')

  // Wait for P2P sync to Bob's node
  console.log('\n⏳ Syncing proposal to Bob\'s node via P2P...')
  await new Promise(resolve => setTimeout(resolve, 3000))

  // ════════════════════════════════════
  // Step 6: Bob Signs the Proposal
  // ════════════════════════════════════
  console.log('\n✍️  Step 6: Bob Signs the Proposal (on his node)\n')

  await bobManager.sign(proposalId)
  console.log('✅ Bob signed (2/2)')

  // Wait for signature to sync back to Alice
  console.log('\n⏳ Syncing signature back to Alice\'s node via P2P...')
  await new Promise(resolve => setTimeout(resolve, 3000))

  // ════════════════════════════════════
  // Step 7: Execute the Transaction
  // ════════════════════════════════════
  console.log('\n🚀 Step 7: Alice Executes Transaction\n')

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
  // Cleanup
  // ════════════════════════════════════
  console.log('\n🧹 Cleanup\n')
  
  aliceManager.dispose()
  bobManager.dispose()
  await aliceStorage.close()
  await bobStorage.close()

  console.log('✅ Full flow completed!')
  console.log('\n📊 Summary:')
  console.log('   - Two separate P2P storage nodes (Alice & Bob)')
  console.log('   - Proposals synced via Hypercore/Autobase')
  console.log('   - Transaction executed on-chain')
}

fullFlow().catch(err => {
  console.error('\n❌ Error:', err.message)
  console.error(err.stack)
  process.exit(1)
})