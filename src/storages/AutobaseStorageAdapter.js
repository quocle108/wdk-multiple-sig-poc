import Corestore from 'corestore'
import Autobase from 'autobase'
import Hyperbee from 'hyperbee'
import Hyperswarm from 'hyperswarm'
import { StorageAdapter } from './StorageAdapter.js'

/**
 * AutobaseStorageAdapter - P2P storage using Autobase/Hyperswarm
 * Implements the StorageAdapter interface
 */
export class AutobaseStorageAdapter extends StorageAdapter {
  constructor(config) {
    super()
    
    this.storagePath = config.storagePath || './data/multisig'
    this.nodeId = config.nodeId || 'node'
    
    if (config.bootstrapKey) {
      this.bootstrapKey = config.bootstrapKey
    } else {
      this.bootstrapKey = null
    }
    
    this.store = null
    this.base = null
    this.bee = null
    this.swarm = null
  }
  
  // ════════════════════════════════════
  // Initialization
  // ════════════════════════════════════
  
  async init() {
    console.log(`[${this.nodeId}] Initializing Autobase storage...`)
    
    if (this.bootstrapKey) {
      console.log(`[${this.nodeId}] Bootstrap mode: Joining existing Autobase`)
      console.log(`[${this.nodeId}]   Bootstrap key: ${this.bootstrapKey.toString('hex').slice(0, 16)}...`)
    } else {
      console.log(`[${this.nodeId}] Bootstrap mode: Creating NEW Autobase`)
    }
    
    this.store = new Corestore(this.storagePath)
    await this.store.ready()
    
    this.base = new Autobase(this.store, this.bootstrapKey, {
      apply: this._applyOperations.bind(this),
      open: this._createView.bind(this),
      valueEncoding: 'json'
    })
    
    await this.base.ready()
    
    console.log(`[${this.nodeId}] Autobase ready`)
    console.log(`[${this.nodeId}]    base.key: ${this.base.key.toString('hex').slice(0, 16)}...`)
    console.log(`[${this.nodeId}]    discoveryKey: ${this.base.discoveryKey.toString('hex').slice(0, 16)}...`)
    console.log(`[${this.nodeId}]    local.key: ${this.base.local.key.toString('hex').slice(0, 16)}...`)
    console.log(`[${this.nodeId}]    Writable: ${this.base.writable}`)
    
    await this._setupNetwork()
    
    console.log(`[${this.nodeId}] Storage initialized`)
    
    return this
  }
  
  async _setupNetwork() {
    this.swarm = new Hyperswarm()
    
    this.swarm.on('connection', async (conn, info) => {
      console.log(`[${this.nodeId}] Peer connected`)
      const peerId = info.publicKey?.toString('hex') || 'unknown-' + Date.now()
      console.log('New peer connection:', peerId.slice(0, 8) + '...')
      this.store.replicate(conn)
      
      await this._sendRegistration(conn)
      
      // Listen for peer registration (ONCE - after that it's binary replication data)
      conn.once('data', async (data) => {
        try {
          const msg = JSON.parse(data.toString())
          if (msg.type === 'REGISTER_NODE') {
            console.log(`[${this.nodeId}] Peer registered: ${msg.nodeId}`)
            
            // Add peer as writer if we're the bootstrap node (writable and no bootstrap key)
            if (this.base.writable && !this.bootstrapKey) {
              const writerKey = Buffer.from(msg.writerKey, 'hex')
              await this._addWriter(msg.nodeId, writerKey)
            }
          }
        } catch (e) {
          console.error(`[${this.nodeId}] Failed to parse registration:`, e.message)
        }
      })
    })
    
    console.log(`[${this.nodeId}] Joining swarm with discovery key: ${this.base.discoveryKey.toString('hex').slice(0, 16)}...`)
    
    this.swarm.join(this.base.discoveryKey, {
      server: true,
      client: true
    })
    
    await this.swarm.flush()
  }
  
  async _sendRegistration(conn) {
    const msg = {
      type: 'REGISTER_NODE',
      nodeId: this.nodeId,
      writerKey: this.base.local.key.toString('hex'),
      timestamp: Date.now()
    }
    
    conn.write(JSON.stringify(msg))
  }
  
  async _addWriter(nodeId, writerKey) {
    console.log(`[${this.nodeId}] Adding writer: ${nodeId}`)
    
    try {
      await this.base.append({
        type: 'ADD_WRITER',
        nodeId,
        writerKey: writerKey.toString('hex'),
        timestamp: Date.now()
      })
      
      await this.base.update()
      
      console.log(`[${this.nodeId}] Writer added: ${nodeId}`)
    } catch (error) {
      console.error(`[${this.nodeId}] Failed to add writer:`, error.message)
    }
  }
  
  // ════════════════════════════════════
  // Autobase Callbacks
  // ════════════════════════════════════
  
  _createView(store) {
    this.bee = new Hyperbee(store.get('multisig-data'), {
      keyEncoding: 'utf-8',
      valueEncoding: 'json'
    })
    return this.bee
  }
  
  async _applyOperations(batch, view, base) {
    for (const node of batch) {
      const op = node.value
      if (!op || typeof op !== 'object') continue
      
      console.log(`[${this.nodeId}] Applying: ${op.type}`)
      
      try {
        await this._handleOperation(op, view, base)
      } catch (error) {
        console.error(`[${this.nodeId}] Failed to apply:`, error.message)
      }
    }
  }
  
  async _handleOperation(op, view, base) {
    switch (op.type) {
      case 'SAVE_MULTISIG_INFO':
        await view.put(`multisig:${op.data.address}`, op.data)
        break
        
      case 'SAVE_PROPOSAL':
        await view.put(`proposal:${op.data.id}`, op.data)
        break
        
      case 'ADD_SIGNATURE':
        const proposal = await view.get(`proposal:${op.proposalId}`)
        if (proposal) {
          proposal.value.signatures.push(op.signature)
          await view.put(`proposal:${op.proposalId}`, proposal.value)
        }
        break
        
      case 'UPDATE_STATUS':
        const prop = await view.get(`proposal:${op.proposalId}`)
        if (prop) {
          Object.assign(prop.value, op.update)
          await view.put(`proposal:${op.proposalId}`, prop.value)
        }
        break
        
      case 'ADD_WRITER':
        const writerKey = Buffer.from(op.writerKey, 'hex')
        console.log(`[${this.nodeId}] Adding writer from operation: ${op.nodeId}`)
        await base.addWriter(writerKey, { isIndexer: true })
        console.log(`[${this.nodeId}] Writer added via operation: ${op.nodeId}`)
        break
    }
  }
  
  // ════════════════════════════════════
  // StorageAdapter Interface Implementation
  // ════════════════════════════════════
  
  async close() {
    console.log(`[${this.nodeId}] Closing storage...`)
    
    if (this.swarm) {
      await this.swarm.destroy()
    }
    if (this.base) {
      await this.base.close()
    }
    if (this.store) {
      await this.store.close()
    }
    
    console.log(`[${this.nodeId}] Storage closed`)
  }
  
  canWrite() {
    return this.base?.writable || false
  }
  
  // ════════════════════════════════════
  // Multisig Info
  // ════════════════════════════════════
  
  async saveMultisigInfo(info) {
    console.log(`[${this.nodeId}] Saving multisig info: ${info.address}`)
    
    await this.base.append({
      type: 'SAVE_MULTISIG_INFO',
      data: info,
      timestamp: Date.now()
    })
    
    await this.base.update()
  }
  
  async getMultisigInfo(address) {
    const result = await this.base.view.get(`multisig:${address}`)
    return result?.value || null
  }
  
  async listMultisigsByUser(userAddress) {
    const result = []
    
    try {
      for await (const { key, value } of this.base.view.createReadStream({
        gte: 'multisig:',
        lt: 'multisig:\xFF'
      })) {
        if (value.owners && value.owners.includes(userAddress)) {
          result.push(value)
        }
      }
    } catch (error) {
      console.error(`[${this.nodeId}] Error listing multisigs:`, error.message)
    }
    
    return result
  }
  
  async listAllMultisigs() {
    const result = []
    
    try {
      for await (const { key, value } of this.base.view.createReadStream({
        gte: 'multisig:',
        lt: 'multisig:\xFF'
      })) {
        result.push(value)
      }
    } catch (error) {
      console.error(`[${this.nodeId}] Error listing all multisigs:`, error.message)
    }
    
    return result
  }
  
  // ════════════════════════════════════
  // Proposals
  // ════════════════════════════════════
  
  async saveProposal(proposal) {
    console.log(`[${this.nodeId}] Saving proposal: ${proposal.id}`)
    
    await this.base.append({
      type: 'SAVE_PROPOSAL',
      data: proposal,
      timestamp: Date.now()
    })
    
    await this.base.update()
  }
  
  async getProposal(proposalId) {
    const result = await this.base.view.get(`proposal:${proposalId}`)
    return result?.value || null
  }
  
  async updateProposalStatus(proposalId, update) {
    console.log(`[${this.nodeId}] Updating proposal status: ${proposalId}`)
    
    await this.base.append({
      type: 'UPDATE_STATUS',
      proposalId,
      update,
      timestamp: Date.now()
    })
    
    await this.base.update()
  }
  
  async listProposals(multisigAddress, filter = {}) {
    const result = []
    
    try {
      for await (const { key, value } of this.base.view.createReadStream({
        gte: 'proposal:',
        lt: 'proposal:\xFF'
      })) {
        if (value.multisigAddress === multisigAddress) {
          if (!filter.status || value.status === filter.status) {
            result.push(value)
          }
        }
      }
    } catch (error) {
      console.error(`[${this.nodeId}] Error listing proposals:`, error.message)
    }
    
    return result
  }
  
  async listProposalsByUser(userAddress, filter = {}) {
    const result = []
    
    try {
      // First, find all multisigs where user is an owner
      const userMultisigs = await this.listMultisigsByUser(userAddress)
      const multisigAddresses = userMultisigs.map(m => m.address)
      
      // Then find all proposals for those multisigs
      for await (const { key, value } of this.base.view.createReadStream({
        gte: 'proposal:',
        lt: 'proposal:\xFF'
      })) {
        if (multisigAddresses.includes(value.multisigAddress)) {
          if (!filter.status || value.status === filter.status) {
            result.push(value)
          }
        }
      }
    } catch (error) {
      console.error(`[${this.nodeId}] Error listing proposals by user:`, error.message)
    }
    
    return result
  }
  
  // ════════════════════════════════════
  // Signatures
  // ════════════════════════════════════
  
  async addSignature(proposalId, signature) {
    console.log(`[${this.nodeId}] Adding signature to: ${proposalId}`)
    
    await this.base.append({
      type: 'ADD_SIGNATURE',
      proposalId,
      signature,
      timestamp: Date.now()
    })
    
    await this.base.update()
  }
  
  // ════════════════════════════════════
  // Export / Import
  // ════════════════════════════════════
  
  async exportProposal(proposalId) {
    const proposal = await this.getProposal(proposalId)
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
    const info = await this.getMultisigInfo(address)
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
  
  // ════════════════════════════════════
  // P2P Coordination (Autobase-specific)
  // ════════════════════════════════════
  
  get discoveryKey() {
    return this.base.discoveryKey
  }
  
  get localKey() {
    return this.base.local.key
  }
}

export default AutobaseStorageAdapter