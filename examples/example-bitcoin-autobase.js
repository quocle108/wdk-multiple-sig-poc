// Bitcoin P2WSH multisig flow test
// Simulates two separate nodes (Alice and Bob) in a single script

import { BitcoinMultisig } from '../src/BitcoinMultisig.js'
import { AutobaseStorageAdapter } from '../src/storages/AutobaseStorageAdapter.js'
import dotenv from 'dotenv'
dotenv.config()

const ALICE_SEED_PHRASE = process.env.ALICE_SEED_PHRASE
const BOB_SEED_PHRASE = process.env.BOB_SEED_PHRASE

// Use testnet for testing
const NETWORK = 'testnet'

async function testBitcoinMultisig() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  Bitcoin P2WSH Multisig Test')
  console.log('  (Alice and Bob as separate P2P nodes)')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

  try {
    // ════════════════════════════════════
    // Step 1: Initialize Separate Storage Nodes
    // ════════════════════════════════════
    console.log('💾 Step 1: Initialize Separate Storage Nodes\n')

    // Alice's storage node
    const aliceStorage = new AutobaseStorageAdapter({
      storagePath: './btc-test-data/alice',
      nodeId: 'alice'
    })
    await aliceStorage.init()
    console.log('Alice storage initialized')

    // Bob's storage node (separate directory, connects to Alice's Autobase)
    const bobStorage = new AutobaseStorageAdapter({
      storagePath: './btc-test-data/bob',
      nodeId: 'bob',
      bootstrapKey: aliceStorage.base.key  // Connect to Alice's Autobase
    })
    await bobStorage.init()
    console.log('Bob storage initialized')
    
    console.log('⏳ Waiting for P2P connection...')
    await new Promise(resolve => setTimeout(resolve, 3000))
    console.log('P2P nodes connected\n')

    // ════════════════════════════════════
    // Step 2: Create Alice & Bob Managers
    // ════════════════════════════════════
    console.log('🏗️  Step 2: Create Managers\n')

    const aliceManager = new BitcoinMultisig(ALICE_SEED_PHRASE, "0'/0/0", {
      network: NETWORK,
      host: 'electrum.blockstream.info',
      port: 60001,  // Testnet SSL port
      storage: aliceStorage  // Alice uses her own storage node
    })

    const bobManager = new BitcoinMultisig(BOB_SEED_PHRASE, "0'/0/0", {
      network: NETWORK,
      host: 'electrum.blockstream.info',
      port: 60001,
      storage: bobStorage  // Bob uses his own storage node
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
    console.log('🚀 Step 3: Create 2-of-2 Multisig (on Alice\'s node)\n')

    const multisig = await aliceManager.create(
      [alicePubkey, bobPubkey],
      2
    )

    console.log('📬 Multisig Address:', multisig.address)
    console.log('👥 Owners:', multisig.owners.length)
    console.log('🔐 Threshold:', multisig.threshold)

    // Wait for P2P sync
    console.log('\n⏳ Syncing multisig info to Bob\'s node via P2P...')
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Bob imports the same multisig (from his own storage node)
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
      await aliceStorage.close()
      await bobStorage.close()
      return
    }

    // ════════════════════════════════════
    // Step 5: Alice Proposes Transaction
    // ════════════════════════════════════
    console.log('\n📝 Step 5: Alice Proposes Transaction (on her node)\n')

    // Send a small amount back to Alice's address
    const proposalId = await aliceManager.propose({
      to: aliceAddress,
      value: 1000  // 1000 satoshis
    })

    console.log('Proposal ID:', proposalId)
    console.log('Alice signed (1/2)')

    // Wait for P2P sync to Bob's node
    console.log('\n⏳ Syncing proposal to Bob\'s node via P2P...')
    await new Promise(resolve => setTimeout(resolve, 3000))

    // ════════════════════════════════════
    // Step 6: Bob Signs
    // ════════════════════════════════════
    console.log('\n✍️  Step 6: Bob Signs (on his node)\n')

    await bobManager.sign(proposalId)
    console.log('Bob signed (2/2)')

    // Wait for signature to sync back to Alice
    console.log('\n⏳ Syncing signature back to Alice\'s node via P2P...')
    await new Promise(resolve => setTimeout(resolve, 3000))

    // ════════════════════════════════════
    // Step 7: Execute
    // ════════════════════════════════════
    console.log('\n🚀 Step 7: Alice Executes Transaction\n')

    const result = await aliceManager.execute(proposalId)

    console.log('🎉 Transaction executed!')
    console.log('TX Hash:', result.txHash)

    // ════════════════════════════════════
    // Cleanup
    // ════════════════════════════════════
    console.log('\n🧹 Cleanup\n')
    
    aliceManager.dispose()
    bobManager.dispose()
    await aliceStorage.close()
    await bobStorage.close()

    console.log('Bitcoin multisig test completed!')
    console.log('\n Summary:')
    console.log('   - Two separate P2P storage nodes (Alice & Bob)')
    console.log('   - Proposals synced via Hypercore/Autobase')
    console.log('   - Transaction broadcast to Bitcoin testnet')

  } catch (error) {
    console.error('\n❌ Error:', error.message)
    console.error(error.stack)
  }
}

testBitcoinMultisig().catch(console.error)