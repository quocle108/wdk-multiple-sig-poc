// Bitcoin P2WSH multisig with in-memory storage
// Simulates Alice and Bob in a single script with shared memory storage

import { BitcoinMultisig } from '../src/BitcoinMultisig.js'
import { MemoryStorageAdapter } from '../src/storages/MemoryStorageAdapter.js'
import dotenv from 'dotenv'
dotenv.config()

const ALICE_SEED_PHRASE = process.env.ALICE_SEED_PHRASE
const BOB_SEED_PHRASE = process.env.BOB_SEED_PHRASE

// Use testnet for testing
const NETWORK = 'testnet'

async function testBitcoinMultisigMemory() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  Bitcoin P2WSH Multisig Test')
  console.log('  (In-Memory Storage - Fast & Simple)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  try {
    // ════════════════════════════════════
    // Step 1: Initialize Shared Memory Storage
    // ════════════════════════════════════
    console.log('💾 Step 1: Initialize Shared Memory Storage\n')

    // Single shared storage for both Alice and Bob
    const storage = new MemoryStorageAdapter()
    await storage.init()
    console.log('✅ Memory storage initialized (shared between Alice & Bob)\n')

    // ════════════════════════════════════
    // Step 2: Create Alice & Bob Managers
    // ════════════════════════════════════
    console.log('🏗️  Step 2: Create Managers\n')

    const aliceManager = new BitcoinMultisig(ALICE_SEED_PHRASE, "0'/0/0", {
      network: NETWORK,
      host: 'electrum.blockstream.info',
      port: 60001,  // Testnet SSL port
      storage  // Both share the same storage
    })

    const bobManager = new BitcoinMultisig(BOB_SEED_PHRASE, "0'/0/0", {
      network: NETWORK,
      host: 'electrum.blockstream.info',
      port: 60001,
      storage  // Both share the same storage
    })

    const aliceAddress = await aliceManager.getSignerAddress()
    const bobAddress = await bobManager.getSignerAddress()
    const alicePubkey = aliceManager.getPublicKey()
    const bobPubkey = bobManager.getPublicKey()

    console.log('Alice:')
    console.log('  Address:', aliceAddress)
    console.log('  Pubkey:', alicePubkey.slice(0, 20) + '...')
    console.log()
    console.log('Bob:')
    console.log('  Address:', bobAddress)
    console.log('  Pubkey:', bobPubkey.slice(0, 20) + '...')
    console.log()

    // ════════════════════════════════════
    // Step 3: Create 2-of-2 Multisig
    // ════════════════════════════════════
    console.log('🚀 Step 3: Create 2-of-2 Multisig\n')

    const multisig = await aliceManager.create(
      [alicePubkey, bobPubkey],
      2
    )

    console.log('📬 Multisig Address:', multisig.address)
    console.log('👥 Owners:', multisig.owners.length)
    console.log('🔐 Threshold:', multisig.threshold)

    // Bob imports the same multisig (from shared storage)
    await bobManager.import(multisig.address, multisig.witnessScript)
    console.log('Bob connected to multisig\n')

    // ════════════════════════════════════
    // Step 4: Check Balance
    // ════════════════════════════════════
    console.log('💰 Step 4: Check Balance\n')

    const balance = await aliceManager.getBalance()
    console.log('Multisig balance:', balance.toString(), 'satoshis')

    if (balance === 0n) {
      console.log('\n⚠️  Multisig needs funding!')
      console.log('Send testnet BTC to:', multisig.address)
      console.log('Get testnet BTC from: https://coinfaucet.eu/en/btc-testnet/')
      console.log('\nThen run this script again to test propose → sign → execute.\n')
      
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

    // Send a small amount back to Alice's address
    const proposalId = await aliceManager.propose({
      to: aliceAddress,
      value: 1000  // 1000 satoshis
    })

    console.log('Proposal ID:', proposalId)
    console.log('Alice signed (1/2)')

    // ════════════════════════════════════
    // Step 6: Bob Signs (immediately available from shared storage)
    // ════════════════════════════════════
    console.log('\n✍️  Step 6: Bob Signs\n')

    await bobManager.sign(proposalId)
    console.log('Bob signed (2/2)')

    // ════════════════════════════════════
    // Step 7: Execute
    // ════════════════════════════════════
    console.log('\n🚀 Step 7: Execute Transaction\n')

    const result = await aliceManager.execute(proposalId)

    console.log('🎉 Transaction executed!')
    console.log('TX Hash:', result.txHash)

    // ════════════════════════════════════
    // Step 8: Query Storage
    // ════════════════════════════════════
    console.log('\n📊 Step 8: Query Storage\n')

    // List Alice's multisigs
    const aliceMultisigs = await storage.listMultisigsByUser(alicePubkey)
    console.log(`Alice's multisigs: ${aliceMultisigs.length}`)

    // List Bob's proposals
    const bobProposals = await storage.listProposalsByUser(bobPubkey)
    console.log(`Bob's proposals: ${bobProposals.length}`)

    // List pending proposals
    const pendingProposals = await storage.listProposals(multisig.address, { status: 'pending' })
    console.log(`Pending proposals: ${pendingProposals.length}`)

    // List executed proposals
    const executedProposals = await storage.listProposals(multisig.address, { status: 'executed' })
    console.log(`Executed proposals: ${executedProposals.length}`)

    // ════════════════════════════════════
    // Cleanup
    // ════════════════════════════════════
    console.log('\n🧹 Cleanup\n')
    
    aliceManager.dispose()
    bobManager.dispose()
    await storage.close()

    console.log('✅ Bitcoin multisig test completed!')
    console.log('\n📊 Summary:')
    console.log('   - Shared in-memory storage')
    console.log('   - No P2P networking needed')
    console.log('   - Perfect for testing')
    console.log('   - Data exists only during script execution')

  } catch (error) {
    console.error('\n❌ Error:', error.message)
    console.error(error.stack)
  }
}

testBitcoinMultisigMemory().catch(console.error)