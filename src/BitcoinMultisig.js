'use strict'

import { payments, Psbt, networks, crypto, script as btcScript } from 'bitcoinjs-lib'
import { WalletAccountBtc } from '@tetherto/wdk-wallet-btc'
import * as ecc from '@bitcoinerlab/secp256k1'
import { MultisigManager } from './MultisigManager.js'

/**
 * @typedef {Object} BitcoinMultisigConfig
 * @property {string} [network] - Network name ('bitcoin', 'testnet', 'regtest')
 * @property {string} [host] - Electrum server host
 * @property {number} [port] - Electrum server port
 * @property {StorageAdapter} [storage] - Storage adapter instance
 */

/**
 * BitcoinMultisig - Manages Bitcoin P2WSH multisig wallets
 * 
 */
export class BitcoinMultisig extends MultisigManager {
  /**
   * Creates a new Bitcoin multisig manager
   * 
   * @param {string | Uint8Array} seed - BIP-39 seed phrase or seed bytes
   * @param {string} path - BIP-84 derivation path (e.g. "0'/0/0")
   * @param {BitcoinMultisigConfig} config - Configuration object
   */
  constructor(seed, path, config = {}) {
    const ownerAccount = new WalletAccountBtc(seed, path, {
      host: config.host || 'electrum.blockstream.info',
      port: config.port || (config.network === 'testnet' ? 60001 : 50001),
      network: config.network || 'bitcoin'
    })

    super(ownerAccount, config)

    this._network = networks[config.network] || networks.bitcoin
    this.networkName = config.network || 'bitcoin'

    this.witnessScript = null  // The multisig script (OP_2 <pk1> <pk2> OP_2 OP_CHECKMULTISIG)
  }

  // ════════════════════════════════════════════════════════════════════════════
  // BITCOIN-SPECIFIC HELPERS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Get the signer's public key as hex string
   * @returns {string} Public key hex
   */
  getPublicKey() {
    const pubkey = this._ownerAccount.keyPair.publicKey
    return Buffer.from(pubkey).toString('hex')
  }

  /**
   * Get the signer's public key as Buffer
   * @returns {Buffer} Public key buffer
   */
  getPublicKeyBuffer() {
    return Buffer.from(this._ownerAccount.keyPair.publicKey)
  }

  /**
   * Get private key as Buffer (for signing)
   * @private
   * @returns {Buffer} Private key buffer
   */
  _getPrivateKey() {
    return Buffer.from(this._ownerAccount.keyPair.privateKey)
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CREATE BITCOIN MULTISIG (P2WSH)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Creates a new P2WSH multisig address
   * 
   * @param {(string|Buffer)[]} owners - Array of public keys (hex strings or Buffers)
   * @param {number} threshold - Number of signatures required
   * @returns {Promise<{address: string, owners: string[], threshold: number, witnessScript: string}>}
   * 
   */
  async create(owners, threshold) {
    console.log(`Creating Bitcoin multisig: ${threshold}-of-${owners.length}`)

    if (owners.length < 2) {
      throw new Error('Need at least 2 owners for multisig')
    }
    if (owners.length > 15) {
      throw new Error('Maximum 15 owners for Bitcoin multisig')
    }
    if (threshold < 1 || threshold > owners.length) {
      throw new Error(`Threshold must be between 1 and ${owners.length}`)
    }

    const pubkeyBuffers = owners.map(owner => {
      if (Buffer.isBuffer(owner)) return owner
      if (typeof owner === 'string') return Buffer.from(owner, 'hex')
      if (owner instanceof Uint8Array) return Buffer.from(owner)
      throw new Error('Owner must be public key as Buffer, Uint8Array, or hex string')
    })

    for (const pk of pubkeyBuffers) {
      if (pk.length !== 33) {
        throw new Error(`Invalid public key length: ${pk.length}. Expected 33 bytes (compressed).`)
      }
    }

    const signerPubkey = this.getPublicKeyBuffer()
    const signerInOwners = pubkeyBuffers.some(pk => pk.equals(signerPubkey))
    if (!signerInOwners) {
      throw new Error('Signer public key must be in owners list')
    }

    const sortedPubkeys = [...pubkeyBuffers].sort(Buffer.compare)

    const p2ms = payments.p2ms({
      m: threshold,
      pubkeys: sortedPubkeys,
      network: this._network
    })

    const p2wsh = payments.p2wsh({
      redeem: p2ms,
      network: this._network
    })

    this.address = p2wsh.address
    this.witnessScript = p2ms.output  // The actual multisig script
    this.owners = sortedPubkeys.map(pk => pk.toString('hex'))
    this.threshold = threshold

    console.log(`Bitcoin multisig created`)
    console.log(`   Address: ${this.address}`)
    console.log(`   Type: P2WSH (Native SegWit)`)
    console.log(`   Network: ${this.networkName}`)

    if (this.storage) {
      const signerAddress = await this.getSignerAddress()
      await this.storage.saveMultisigInfo({
        address: this.address,
        owners: this.owners,
        threshold,
        type: 'bitcoin-p2wsh',
        network: this.networkName,
        witnessScript: this.witnessScript.toString('hex'),
        createdBy: signerAddress,
        createdAt: Date.now()
      })
      console.log('Saved to storage')
    }

    return {
      address: this.address,
      owners: this.owners,
      threshold,
      witnessScript: this.witnessScript.toString('hex')
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // IMPORT EXISTING MULTISIG
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Imports an existing Bitcoin multisig wallet
   * 
   * @param {string} address - The multisig address
   * @param {string} witnessScript - The witness script (hex)
   * @returns {Promise<{address: string, owners: string[], threshold: number}>}
   */
  async import(address, witnessScript) {
    console.log(`Importing Bitcoin multisig at: ${address}`)

    if (!witnessScript) {
      if (this.storage) {
        const info = await this.storage.getMultisigInfo(address)
        if (info && info.witnessScript) {
          witnessScript = info.witnessScript
        } else {
          throw new Error('Witness script required for import. Provide it or ensure it exists in storage.')
        }
      } else {
        throw new Error('Witness script required for import')
      }
    }

    this.address = address
    this.witnessScript = Buffer.from(witnessScript, 'hex')

    const decompiled = btcScript.decompile(this.witnessScript)
    if (!decompiled) {
      throw new Error('Failed to decompile witness script')
    }

    // Extract threshold (first opcode: OP_1 = 81, OP_2 = 82, etc.)
    const thresholdOpcode = decompiled[0]
    this.threshold = thresholdOpcode - 80  // OP_1 = 81, so threshold = 81 - 80 = 1

    // Extract number of owners (second to last opcode)
    const ownersOpcode = decompiled[decompiled.length - 2]
    const numOwners = ownersOpcode - 80

    this.owners = []
    for (let i = 1; i <= numOwners; i++) {
      const pubkey = decompiled[i]
      if (Buffer.isBuffer(pubkey)) {
        this.owners.push(pubkey.toString('hex'))
      }
    }

    console.log(`Imported Bitcoin multisig`)
    console.log(`   Address: ${this.address}`)
    console.log(`   Owners: ${this.owners.length}`)
    console.log(`   Threshold: ${this.threshold}`)

    const signerPubkey = this.getPublicKey()
    const isOwner = this.owners.includes(signerPubkey)
    if (!isOwner) {
      throw new Error('Signer public key not found in multisig owners')
    }

    if (this.storage) {
      const signerAddress = await this.getSignerAddress()
      await this.storage.saveMultisigInfo({
        address: this.address,
        owners: this.owners,
        threshold: this.threshold,
        type: 'bitcoin-p2wsh',
        network: this.networkName,
        witnessScript: this.witnessScript.toString('hex'),
        importedBy: signerAddress,
        importedAt: Date.now()
      })
    }

    return {
      address: this.address,
      owners: this.owners,
      threshold: this.threshold
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TRANSACTION OPERATIONS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Proposes a new transaction (creates and partially signs a PSBT)
   * 
   * @param {Object} transaction - Transaction to propose
   * @param {string} transaction.to - Recipient address
   * @param {number|bigint} transaction.value - Amount in satoshis
   * @returns {Promise<string>} Proposal ID
   */
  async propose(transaction) {
    if (!this.address) {
      throw new Error('Multisig not initialized. Call create() or import() first.')
    }

    console.log('Creating transaction proposal')
    console.log('  To:', transaction.to)
    console.log('  Value:', transaction.value, 'satoshis')

    const utxos = await this._getUtxos(this.address)
    if (utxos.length === 0) {
      throw new Error('No UTXOs available for this multisig address')
    }

    const value = Number(transaction.value)
    const feeRate = await this._getFeeRate()

    const totalAvailable = utxos.reduce((sum, u) => sum + u.value, 0)
    
    // Estimate fee (rough: 150 vbytes per input, 50 per output for P2WSH)
    const estimatedVsize = utxos.length * 150 + 2 * 50
    const estimatedFee = Math.ceil(estimatedVsize * feeRate)
    
    if (totalAvailable < value + estimatedFee) {
      throw new Error(`Insufficient funds. Available: ${totalAvailable}, Required: ${value + estimatedFee}`)
    }

    const psbt = new Psbt({ network: this._network })

    for (const utxo of utxos) {
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        witnessUtxo: {
          script: payments.p2wsh({
            redeem: { output: this.witnessScript, network: this._network },
            network: this._network
          }).output,
          value: utxo.value
        },
        witnessScript: this.witnessScript
      })
    }

    // Add recipient output
    psbt.addOutput({
      address: transaction.to,
      value: value
    })

    // Add change output if needed
    const changeValue = totalAvailable - value - estimatedFee
    if (changeValue > 546) {  // Dust limit
      psbt.addOutput({
        address: this.address,
        value: changeValue
      })
    }

    const privateKey = this._getPrivateKey()
    const signerKeyPair = {
      publicKey: this.getPublicKeyBuffer(),
      sign: (hash) => {
        return Buffer.from(ecc.sign(hash, privateKey))
      }
    }

    for (let i = 0; i < psbt.inputCount; i++) {
      psbt.signInput(i, signerKeyPair)
    }

    const signerAddress = await this.getSignerAddress()
    const proposalId = crypto.sha256(Buffer.from(psbt.toBase64())).toString('hex').slice(0, 16)

    console.log(`Proposal created`)
    console.log(`   Proposal ID: ${proposalId}`)
    console.log(`   Signed by: ${signerAddress}`)

    if (this.storage) {
      await this.storage.saveProposal({
        id: proposalId,
        multisigAddress: this.address,
        transaction: {
          to: transaction.to,
          value: value
        },
        psbt: psbt.toBase64(),
        signatures: [{
          signer: this.getPublicKey(),
          signedAt: Date.now()
        }],
        status: 'pending',
        createdAt: Date.now(),
        createdBy: signerAddress
      })
      console.log('Saved to storage')
    }

    return proposalId
  }

  /**
   * Signs an existing proposal
   * 
   * @param {string} proposalId - The proposal ID to sign
   * @returns {Promise<void>}
   */
  async sign(proposalId) {
    console.log(`Signing proposal: ${proposalId}`)

    if (!this.storage) {
      throw new Error('Storage not configured')
    }

    const proposal = await this.storage.getProposal(proposalId)
    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`)
    }

    // Check if already signed by this signer
    const signerPubkey = this.getPublicKey()
    const alreadySigned = proposal.signatures.some(sig => sig.signer === signerPubkey)
    if (alreadySigned) {
      throw new Error('Proposal already signed by this signer')
    }

    const psbt = Psbt.fromBase64(proposal.psbt, { network: this._network })

    const privateKey = this._getPrivateKey()
    const signerKeyPair = {
      publicKey: this.getPublicKeyBuffer(),
      sign: (hash) => {
        return Buffer.from(ecc.sign(hash, privateKey))
      }
    }

    for (let i = 0; i < psbt.inputCount; i++) {
      psbt.signInput(i, signerKeyPair)
    }

    console.log(`Signed by: ${signerPubkey.slice(0, 16)}...`)

    if (this.storage) {
      await this.storage.saveProposal({
        ...proposal,
        psbt: psbt.toBase64(),
        signatures: [
          ...proposal.signatures,
          {
            signer: signerPubkey,
            signedAt: Date.now()
          }
        ]
      })
      console.log('Signature saved to storage')
    }

    // Check threshold
    const sigCount = proposal.signatures.length + 1
    console.log(`   Signatures: ${sigCount}/${this.threshold}`)

    if (sigCount >= this.threshold) {
      console.log(' Threshold met! Ready to execute.')
    }
  }

  /**
   * Executes a proposal that has enough signatures
   * 
   * @param {string} proposalId - The proposal ID to execute
   * @returns {Promise<{success: boolean, txHash: string}>}
   */
  async execute(proposalId) {
    console.log(`Executing proposal: ${proposalId}`)

    if (!this.storage) {
      throw new Error('Storage not configured')
    }

    const proposal = await this.storage.getProposal(proposalId)
    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`)
    }

    if (proposal.status !== 'pending') {
      throw new Error(`Proposal already ${proposal.status}`)
    }

    if (proposal.signatures.length < this.threshold) {
      throw new Error(
        `Not enough signatures: ${proposal.signatures.length}/${this.threshold}`
      )
    }

    console.log('Finalizing transaction...')

    const psbt = Psbt.fromBase64(proposal.psbt, { network: this._network })

    for (let i = 0; i < psbt.inputCount; i++) {
      psbt.finalizeInput(i)
    }

    const tx = psbt.extractTransaction()
    const txHex = tx.toHex()
    const txHash = tx.getId()

    console.log('Broadcasting transaction...')

    await this._ownerAccount._electrumClient.blockchainTransaction_broadcast(txHex)

    console.log('Transaction broadcast!')
    console.log(`   TX Hash: ${txHash}`)

    // Get explorer URL
    const explorerUrls = {
      bitcoin: 'https://mempool.space',
      testnet: 'https://blockstream.info/testnet',
      regtest: 'http://localhost:8080'
    }
    const explorer = explorerUrls[this.networkName] || explorerUrls.bitcoin
    console.log(`View: ${explorer}/tx/${txHash}`)

    if (this.storage) {
      const signerAddress = await this.getSignerAddress()
      await this.storage.updateProposalStatus(proposalId, {
        status: 'executed',
        txHash,
        executedAt: Date.now(),
        executedBy: signerAddress
      })
    }

    return {
      success: true,
      txHash
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // BITCOIN-SPECIFIC QUERIES
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Gets the witness script
   * @returns {string} Witness script hex
   */
  getWitnessScript() {
    if (!this.witnessScript) {
      throw new Error('Multisig not initialized')
    }
    return this.witnessScript.toString('hex')
  }

  /**
   * Gets the balance of the multisig address in satoshis
   * @returns {Promise<bigint>}
   */
  async getBalance() {
    if (!this.address) {
      throw new Error('Multisig not initialized')
    }

    const utxos = await this._getUtxos(this.address)
    const total = utxos.reduce((sum, u) => sum + BigInt(u.value), 0n)
    return total
  }

  // ════════════════════════════════════════════════════════════════════════════
  // HELPER METHODS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Get UTXOs for an address using electrum
   * @private
   */
  async _getUtxos(address) {
    const script = payments.p2wsh({
      redeem: { output: this.witnessScript, network: this._network },
      network: this._network
    }).output

    const scriptHash = crypto.sha256(script).reverse().toString('hex')
    const utxos = await this._ownerAccount._electrumClient.blockchainScripthash_listunspent(scriptHash)

    return utxos.map(u => ({
      txid: u.tx_hash,
      vout: u.tx_pos,
      value: u.value
    }))
  }

  /**
   * Get fee rate in sat/vbyte
   * @private
   */
  async _getFeeRate() {
    try {
      const feeEstimate = await this._ownerAccount._electrumClient.blockchainEstimatefee(1)
      return Math.max(Number(feeEstimate) * 100_000, 1)  // Convert BTC/kB to sat/vB
    } catch {
      return 10  // Default 10 sat/vB
    }
  }
}

export default BitcoinMultisig