import { StorageAdapter } from './StorageAdapter.js'

/**
 * MemoryStorageAdapter - In-memory storage (no persistence)
 * 
 * Useful for:
 * - Testing
 * - Temporary operations
 * - When persistence is not needed
 * 
 * Note: All data is lost when the process exits
 */
export class MemoryStorageAdapter extends StorageAdapter {
  constructor() {
    super()
    
    this.multisigs = new Map()  // address -> info
    this.proposals = new Map()  // proposalId -> proposal
    this._initialized = false
  }
  
  // ══════════════════════════════════════════════════════════
  // INITIALIZATION & LIFECYCLE
  // ══════════════════════════════════════════════════════════
  
  async init() {
    console.log('[MemoryStorage] Initializing in-memory storage...')
    this._initialized = true
    console.log('[MemoryStorage] Storage initialized')
  }
  
  async close() {
    console.log('[MemoryStorage] Closing storage...')
    this.multisigs.clear()
    this.proposals.clear()
    this._initialized = false
    console.log('[MemoryStorage] Storage closed')
  }
  
  canWrite() {
    return this._initialized
  }
  
  // ══════════════════════════════════════════════════════════
  // MULTISIG INFO STORAGE
  // ══════════════════════════════════════════════════════════
  
  async saveMultisigInfo(info) {
    console.log(`[MemoryStorage] Saving multisig info: ${info.address}`)
    this.multisigs.set(info.address, { ...info })
  }
  
  async getMultisigInfo(address) {
    const info = this.multisigs.get(address)
    return info ? { ...info } : null
  }
  
  async listMultisigsByUser(userAddress) {
    const result = []
    
    for (const [_, info] of this.multisigs) {
      const normalizedOwners = info.owners.map(o => o.toLowerCase())
      if (normalizedOwners.includes(userAddress.toLowerCase())) {
        result.push({ ...info })
      }
    }
    
    return result
  }
  
  async listAllMultisigs() {
    return Array.from(this.multisigs.values()).map(info => ({ ...info }))
  }
  
  // ══════════════════════════════════════════════════════════
  // PROPOSAL STORAGE
  // ══════════════════════════════════════════════════════════
  
  async saveProposal(proposal) {
    console.log(`[MemoryStorage] Saving proposal: ${proposal.id}`)
    
    // Deep clone to avoid reference issues
    this.proposals.set(proposal.id, {
      ...proposal,
      signatures: [...proposal.signatures]
    })
  }
  
  async getProposal(proposalId) {
    const proposal = this.proposals.get(proposalId)
    
    if (!proposal) {
      return null
    }
    
    // Return a deep clone
    return {
      ...proposal,
      signatures: [...proposal.signatures]
    }
  }
  
  async updateProposalStatus(proposalId, update) {
    console.log(`[MemoryStorage] Updating proposal status: ${proposalId}`)
    
    const proposal = this.proposals.get(proposalId)
    if (proposal) {
      Object.assign(proposal, update)
    }
  }
  
  async listProposals(multisigAddress, filter = {}) {
    const result = []
    
    for (const [_, proposal] of this.proposals) {
      if (proposal.multisigAddress === multisigAddress) {
        if (!filter.status || proposal.status === filter.status) {
          // Return a deep clone
          result.push({
            ...proposal,
            signatures: [...proposal.signatures]
          })
        }
      }
    }
    
    return result
  }
  
  async listProposalsByUser(userAddress, filter = {}) {
    const result = []
    
    // Find all multisigs where user is owner
    const userMultisigs = await this.listMultisigsByUser(userAddress)
    const multisigAddresses = userMultisigs.map(m => m.address)
    
    for (const [_, proposal] of this.proposals) {
      if (multisigAddresses.includes(proposal.multisigAddress)) {
        if (!filter.status || proposal.status === filter.status) {
          result.push({
            ...proposal,
            signatures: [...proposal.signatures]
          })
        }
      }
    }
    
    return result
  }
  
  // ══════════════════════════════════════════════════════════
  // SIGNATURE MANAGEMENT
  // ══════════════════════════════════════════════════════════
  
  async addSignature(proposalId, signature) {
    console.log(`[MemoryStorage] Adding signature to: ${proposalId}`)
    
    const proposal = this.proposals.get(proposalId)
    if (proposal) {
      proposal.signatures.push({ ...signature })
    } else {
      throw new Error(`Proposal not found: ${proposalId}`)
    }
  }
  
  // ══════════════════════════════════════════════════════════
  // IMPORT / EXPORT (for manual sharing)
  // ══════════════════════════════════════════════════════════
  
  async exportProposal(proposalId) {
    const proposal = this.proposals.get(proposalId)
    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`)
    }
    
    return JSON.stringify(proposal, null, 2)
  }
  
  async importProposal(jsonData) {
    const proposal = JSON.parse(jsonData)
    await this.saveProposal(proposal)
    return proposal.id
  }
  
  async exportMultisigInfo(address) {
    const info = this.multisigs.get(address)
    if (!info) {
      throw new Error(`Multisig not found: ${address}`)
    }
    
    return JSON.stringify(info, null, 2)
  }
  
  async importMultisigInfo(jsonData) {
    const info = JSON.parse(jsonData)
    await this.saveMultisigInfo(info)
    return info.address
  }
}

export default MemoryStorageAdapter