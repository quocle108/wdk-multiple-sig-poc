'use strict'

/**
 * @typedef {Object} MultisigConfig
 * @property {Object} signer - Wallet account object (WalletAccountEvm or WalletAccountBtc)
 * @property {number} [threshold] - Number of signatures required
 * @property {StorageAdapter} [storage] - Storage adapter instance for coordination
 */

/**
 * MultisigManager - Abstract base class for multisig wallet managers
 * 
 * 
 * @abstract
 */
export class MultisigManager {
  /**
   * @param {Object} ownerAccount - Wallet account for signing
   * @param {MultisigConfig} config - Configuration object
   */
  constructor(ownerAccount, config = {}) {

    this._ownerAccount = ownerAccount
    
    this.storage = config.storage || null
    
    if (this.storage && !this._isValidStorage(this.storage)) {
      throw new Error('Storage must implement StorageAdapter interface')
    }

    this.address = null
    this.owners = []
    this.threshold = config.threshold || null
  }
  
  /**
   * Validate storage implements required interface methods
   * @private
   * @param {Object} storage - Storage instance to validate
   * @returns {boolean}
   */
  _isValidStorage(storage) {
    const requiredMethods = [
      'init', 'close',
      'saveMultisigInfo', 'getMultisigInfo',
      'saveProposal', 'getProposal',
      'updateProposalStatus', 'addSignature',
      'exportProposal', 'importProposal'
    ]
    
    return requiredMethods.every(method => typeof storage[method] === 'function')
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ACCOUNT INFO (delegates to owner account)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * The derivation path's index of this account
   * @type {number}
   */
  get index() {
    return this._ownerAccount.index
  }

  /**
   * The derivation path of this account
   * @type {string}
   */
  get path() {
    return this._ownerAccount.path
  }

  /**
   * The account's key pair
   * @type {import('@tetherto/wdk-wallet').KeyPair}
   */
  get keyPair() {
    return this._ownerAccount.keyPair
  }

  /**
   * Get the signer's address
   * @returns {Promise<string>} The signer's address
   */
  async getSignerAddress() {
    return await this._ownerAccount.getAddress()
  }

  /**
   * Signs a message using the owner account
   * @param {string} message - The message to sign
   * @returns {Promise<string>} The signature
   */
  async sign(message) {
    return await this._ownerAccount.sign(message)
  }

  /**
   * Verifies a message's signature
   * @param {string} message - The original message
   * @param {string} signature - The signature to verify
   * @returns {Promise<boolean>} True if valid
   */
  async verify(message, signature) {
    return await this._ownerAccount.verify(message, signature)
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CREATION (must implement in child class)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Creates a new multisig wallet
   * @param {string[]} owners - Array of owner addresses/pubkeys
   * @param {number} threshold - Number of signatures required
   * @returns {Promise<{address: string, owners: string[], threshold: number}>}
   * @abstract
   */
  async create(owners, threshold) {
    throw new Error('Must implement create()')
  }

  /**
   * Imports an existing multisig wallet
   * @param {string} address - The multisig address
   * @param {Object} [options] - Additional options (e.g. witnessScript for Bitcoin)
   * @returns {Promise<{address: string, owners: string[], threshold: number}>}
   * @abstract
   */
  async import(address, options) {
    throw new Error('Must implement import()')
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Transaction management (must implement in child class)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Proposes a new transaction
   * @param {Object} transaction - Transaction details
   * @param {string} transaction.to - Recipient address
   * @param {string|number|bigint} transaction.value - Amount to send
   * @param {string} [transaction.data] - Transaction data (EVM only)
   * @returns {Promise<string>} Proposal ID
   * @abstract
   */
  async propose(transaction) {
    throw new Error('Must implement propose()')
  }

  /**
   * Signs an existing proposal
   * @param {string} proposalId - The proposal ID to sign
   * @returns {Promise<void>}
   * @abstract
   */
  async sign(proposalId) {
    throw new Error('Must implement signProposal()')
  }

  /**
   * Executes a proposal that has enough signatures
   * @param {string} proposalId - The proposal ID to execute
   * @returns {Promise<{success: boolean, txHash: string}>}
   * @abstract
   */
  async execute(proposalId) {
    throw new Error('Must implement execute()')
  }

  // ════════════════════════════════════════════════════════════════════════════
  // QUERIES
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Gets the multisig address
   * @returns {string}
   */
  getAddress() {
    if (!this.address) {
      throw new Error('Multisig not initialized. Call create() or import() first.')
    }
    return this.address
  }

  /**
   * Gets the list of owners
   * @returns {string[]}
   */
  getOwners() {
    return this.owners
  }

  /**
   * Gets the signature threshold
   * @returns {number}
   */
  getThreshold() {
    return this.threshold
  }

  /**
   * Gets the balance of the multisig wallet
   * @param {string} [token] - Token address (EVM) or undefined for native currency
   * @returns {Promise<bigint>}
   * @abstract
   */
  async getBalance(token) {
    throw new Error('Must implement getBalance()')
  }

  /**
   * Gets pending proposals from storage
   * @returns {Promise<Object[]>}
   */
  async getPendingProposals() {
    if (!this.storage) {
      throw new Error('Storage not configured')
    }
    return await this.storage.listProposals(this.address, { status: 'pending' })
  }

  // ════════════════════════════════════════════════════════════════════════════
  // Multisig management
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * @deprecated Threshold is immutable. Create new multisig instead.
   */
  async changeThreshold(newThreshold) {
    throw new Error('Threshold is immutable. Create new multisig instead.')
  }

  /**
   * @deprecated Owners are immutable. Create new multisig instead.
   */
  async addOwner(owner) {
    throw new Error('Owners are immutable. Create new multisig instead.')
  }

  /**
   * @deprecated Owners are immutable. Create new multisig instead.
   */
  async removeOwner(owner) {
    throw new Error('Owners are immutable. Create new multisig instead.')
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MEMORY MANAGEMENT
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Disposes the manager, clearing private keys from memory
   */
  dispose() {
    if (this._ownerAccount && typeof this._ownerAccount.dispose === 'function') {
      this._ownerAccount.dispose()
    }
  }
}

export default MultisigManager