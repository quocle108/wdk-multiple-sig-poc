'use strict'

/**
 * StorageAdapter - Abstract interface for multisig data storage
 * All storage implementations must implement this interface
 * 
 * This allows flexible storage backends:
 * - AutobaseStorageAdapter (P2P via Hypercore)
 * - FileStorageAdapter (local JSON files)
 * - MemoryStorageAdapter (in-memory, for testing)
 * - RemoteStorageAdapter (API backend)
 * - etc.
 */
export class StorageAdapter {
  
  // ══════════════════════════════════════════════════════════
  // INITIALIZATION & LIFECYCLE
  // ══════════════════════════════════════════════════════════
  
  /**
   * Initialize the storage (connect, load data, etc.)
   * @returns {Promise<void>}
   */
  async init() {
    throw new Error('Must implement init()')
  }
  
  /**
   * Close/cleanup storage
   * @returns {Promise<void>}
   */
  async close() {
    throw new Error('Must implement close()')
  }

  
  // ══════════════════════════════════════════════════════════
  // MULTISIG INFO STORAGE
  // ══════════════════════════════════════════════════════════
  
  /**
   * Save multisig wallet info
   * @param {Object} info - Multisig info
   * @returns {Promise<void>}
   */
  async saveMultisigInfo(info) {
    throw new Error('Must implement saveMultisigInfo()')
  }
  
  /**
   * Get multisig info by address
   * @param {string} address - Multisig address
   * @returns {Promise<Object|null>}
   */
  async getMultisigInfo(address) {
    throw new Error('Must implement getMultisigInfo()')
  }
  
  /**
   * List all multisigs for a user (by owner address/pubkey)
   * @param {string} userAddress - User's address or pubkey
   * @returns {Promise<Object[]>}
   */
  async listMultisigsByUser(userAddress) {
    throw new Error('Must implement listMultisigsByUser()')
  }
  
  /**
   * List all multisigs stored
   * @returns {Promise<Object[]>}
   */
  async listAllMultisigs() {
    throw new Error('Must implement listAllMultisigs()')
  }
  
  // ══════════════════════════════════════════════════════════
  // PROPOSAL STORAGE
  // ══════════════════════════════════════════════════════════
  
  /**
   * Save proposal
   * @param {Object} proposal - Proposal data
   * @returns {Promise<void>}
   */
  async saveProposal(proposal) {
    throw new Error('Must implement saveProposal()')
  }
  
  /**
   * Get proposal by ID
   * @param {string} proposalId - Proposal ID
   * @returns {Promise<Object|null>}
   */
  async getProposal(proposalId) {
    throw new Error('Must implement getProposal()')
  }
  
  /**
   * Update proposal status
   * @param {string} proposalId - Proposal ID
   * @param {Object} update - Fields to update
   * @returns {Promise<void>}
   */
  async updateProposalStatus(proposalId, update) {
    throw new Error('Must implement updateProposalStatus()')
  }
  
  /**
   * List proposals for a multisig
   * @param {string} multisigAddress - Multisig address
   * @param {Object} [filter] - Optional filters
   * @param {string} [filter.status] - Filter by status ('pending', 'executed', 'rejected')
   * @returns {Promise<Object[]>}
   */
  async listProposals(multisigAddress, filter = {}) {
    throw new Error('Must implement listProposals()')
  }
  
  /**
   * List proposals where user is a signer
   * @param {string} userAddress - User's address/pubkey
   * @param {Object} [filter] - Optional filters
   * @param {string} [filter.status] - Filter by status
   * @returns {Promise<Object[]>}
   */
  async listProposalsByUser(userAddress, filter = {}) {
    throw new Error('Must implement listProposalsByUser()')
  }
  
  // ══════════════════════════════════════════════════════════
  // SIGNATURE MANAGEMENT
  // ══════════════════════════════════════════════════════════
  
  /**
   * Add signature to proposal
   * (This method is optional - most implementations will just use saveProposal)
   * @param {string} proposalId - Proposal ID
   * @param {Object} signature - Signature data
   * @param {string} signature.signer - Signer address/pubkey
   * @param {string} signature.signature - Signature data
   * @param {number} signature.signedAt - Timestamp
   * @returns {Promise<void>}
   */
  async addSignature(proposalId, signature) {
    throw new Error('Must implement addSignature()')
  }
  
  // ══════════════════════════════════════════════════════════
  // IMPORT / EXPORT (for manual sharing)
  // ══════════════════════════════════════════════════════════
  
  /**
   * Export proposal as JSON
   * @param {string} proposalId - Proposal ID
   * @returns {Promise<string>} JSON string
   */
  async exportProposal(proposalId) {
    throw new Error('Must implement exportProposal()')
  }
  
  /**
   * Import proposal from JSON
   * @param {string} jsonData - JSON string
   * @returns {Promise<string>} Imported proposal ID
   */
  async importProposal(jsonData) {
    throw new Error('Must implement importProposal()')
  }
  
  /**
   * Export multisig info as JSON
   * @param {string} address - Multisig address
   * @returns {Promise<string>} JSON string
   */
  async exportMultisigInfo(address) {
    throw new Error('Must implement exportMultisigInfo()')
  }
  
  /**
   * Import multisig info from JSON
   * @param {string} jsonData - JSON string
   * @returns {Promise<string>} Imported multisig address
   */
  async importMultisigInfo(jsonData) {
    throw new Error('Must implement importMultisigInfo()')
  }
}

export default StorageAdapter