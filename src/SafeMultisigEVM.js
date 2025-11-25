'use strict'

import Safe from '@safe-global/protocol-kit'
import { ethers } from 'ethers'
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'
import { MultisigManager } from './MultisigManager.js'

/**
 * @typedef {Object} SafeMultisigConfig
 * @property {string} provider - RPC URL string
 * @property {string} [network] - Network name ('sepolia', 'mainnet', etc.)
 * @property {StorageAdapter} [storage] - Storage adapter instance
 */

/**
 * SafeMultisigEVM - Manages Safe multisig wallets on EVM chains
 * 
 */
export class SafeMultisigEVM extends MultisigManager {
  /**
   * Creates a new Safe multisig manager
   * 
   * @param {string | Uint8Array} seed - BIP-39 seed phrase or seed bytes
   * @param {string} path - BIP-44 derivation path (e.g. "0'/0/0")
   * @param {SafeMultisigConfig} config - Configuration object
   */
  constructor(seed, path, config) {
    const ownerAccount = new WalletAccountEvm(seed, path, {
      provider: config.provider
    })

    super(ownerAccount, config)

    this.providerUrl = config.provider
    this.network = config.network || 'sepolia'

    this.safeSdk = null
  }

  // ════════════════════════════════════════════════════════════════════════════
  // STATIC HELPERS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Get Safe contract addresses for a network
   * @param {string} network - Network name
   * @returns {Object} Contract addresses
   */
  static getNetworkContracts(network) {
    const contracts = {
      sepolia: {
        PROXY_FACTORY: '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2',
        SAFE_SINGLETON: '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552',
        FALLBACK_HANDLER: '0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4'
      },
      mainnet: {
        PROXY_FACTORY: '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2',
        SAFE_SINGLETON: '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552',
        FALLBACK_HANDLER: '0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4'
      },
      polygon: {
        PROXY_FACTORY: '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2',
        SAFE_SINGLETON: '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552',
        FALLBACK_HANDLER: '0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4'
      },
      arbitrum: {
        PROXY_FACTORY: '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2',
        SAFE_SINGLETON: '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552',
        FALLBACK_HANDLER: '0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4'
      }
    }
    return contracts[network] || contracts.sepolia
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ACCOUNT INFO (delegates to WalletAccountEvm)
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
   * The account's key pair (delegates to WalletAccountEvm)
   * @type {import('@tetherto/wdk-wallet-evm').KeyPair}
   */
  get keyPair() {
    return this._ownerAccount.keyPair
  }

  /**
   * Get the signer's EOA address
   * @returns {Promise<string>} The signer's address
   */
  async getSignerAddress() {
    return await this._ownerAccount.getAddress()
  }

  /**
   * Get private key from WalletAccountEvm as hex string
   * @private
   * @returns {string} Private key with 0x prefix
   */
  _getPrivateKey() {
    const privateKey = this._ownerAccount.keyPair.privateKey
    return '0x' + Buffer.from(privateKey).toString('hex')
  }

  /**
   * Signs a message using the owner account
   * @param {string} message - The message to sign
   * @returns {Promise<string>} The signature
   */
  async signMessage(message) {
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
  // CALCULATE SAFE ADDRESS (OFFCHAIN)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Calculate the Safe address before deploying (deterministic CREATE2)
   * 
   * @param {string[]} owners - Array of owner addresses
   * @param {number} threshold - Number of signatures required
   * @param {number} [saltNonce] - Salt nonce (default: Date.now())
   * @returns {Promise<string>} The predicted Safe address
   */
  async calculateAddress(owners, threshold, saltNonce = Date.now()) {
    const contracts = SafeMultisigEVM.getNetworkContracts(this.network)

    const safeAbi = ['function setup(address[],uint256,address,bytes,address,address,uint256,address)']
    const safeInterface = new ethers.utils.Interface(safeAbi)
    const setupData = safeInterface.encodeFunctionData('setup', [
      owners,
      threshold,
      ethers.constants.AddressZero,
      '0x',
      contracts.FALLBACK_HANDLER,
      ethers.constants.AddressZero,
      0,
      ethers.constants.AddressZero
    ])

    const provider = new ethers.providers.JsonRpcProvider(this.providerUrl)
    const factoryAbi = [
      'function proxyCreationCode() view returns (bytes)',
      'function calculateCreateProxyWithNonceAddress(address _singleton, bytes initializer, uint256 saltNonce) view returns (address)'
    ]
    const factory = new ethers.Contract(contracts.PROXY_FACTORY, factoryAbi, provider)

    const proxyCreationCode = await factory.proxyCreationCode()
    const singletonPadded = ethers.utils.hexZeroPad(contracts.SAFE_SINGLETON, 32)
    const deploymentData = ethers.utils.hexConcat([proxyCreationCode, singletonPadded])
    // salt = keccak256(keccak256(setupData) + saltNonce)
    const salt = ethers.utils.keccak256(
      ethers.utils.solidityPack(
        ['bytes32', 'uint256'],
        [ethers.utils.keccak256(setupData), saltNonce]
      )
    )

    // CREATE2: address = keccak256(0xff + factory + salt + keccak256(deploymentData))[12:]
    const predictedAddress = ethers.utils.getCreate2Address(
      contracts.PROXY_FACTORY,
      salt,
      ethers.utils.keccak256(deploymentData)
    )
    return predictedAddress
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CREATE SAFE MULTISIG
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Creates a new Safe multisig wallet
   * 
   * @param {string[]} owners - Array of owner addresses
   * @param {number} threshold - Number of signatures required
   * @param {number} [saltNonce] - Optional salt nonce (default: Date.now())
   * @returns {Promise<{address: string, owners: string[], threshold: number}>}
   * 
   */
  async create(owners, threshold, saltNonce = Date.now()) {
    console.log(`Creating Safe multisig: ${threshold}-of-${owners.length}`)

    if (owners.length < 2) {
      throw new Error('Need at least 2 owners for multisig')
    }
    if (threshold < 1 || threshold > owners.length) {
      throw new Error(`Threshold must be between 1 and ${owners.length}`)
    }

    const signerAddress = await this.getSignerAddress()
    console.log(`Signer: ${signerAddress}`)

    const normalizedOwners = owners.map(o => o.toLowerCase())
    if (!normalizedOwners.includes(signerAddress.toLowerCase())) {
      throw new Error('Signer address must be in owners list')
    }

    const contracts = SafeMultisigEVM.getNetworkContracts(this.network)

    this.address = await this.calculateAddress(owners, threshold, saltNonce)
    this.owners = owners
    this.threshold = threshold

    console.log(`Predicted Safe address: ${this.address}`)

    const provider = new ethers.providers.JsonRpcProvider(this.providerUrl)
    const privateKey = this._getPrivateKey()
    const ethersSigner = new ethers.Wallet(privateKey, provider)

    const factoryAbi = [
      'function createProxyWithNonce(address _singleton, bytes memory initializer, uint256 saltNonce) public returns (address proxy)'
    ]
    const safeAbi = ['function setup(address[],uint256,address,bytes,address,address,uint256,address)']

    const factory = new ethers.Contract(contracts.PROXY_FACTORY, factoryAbi, ethersSigner)
    const safeInterface = new ethers.utils.Interface(safeAbi)

    const setupData = safeInterface.encodeFunctionData('setup', [
      owners,
      threshold,
      ethers.constants.AddressZero,
      '0x',
      contracts.FALLBACK_HANDLER,
      ethers.constants.AddressZero,
      0,
      ethers.constants.AddressZero
    ])

    console.log('Deploying Safe contract...')
    const tx = await factory.createProxyWithNonce(contracts.SAFE_SINGLETON, setupData, saltNonce)
    const receipt = await tx.wait()

    console.log(`Safe deployed at: ${this.address}`)
    console.log(`   TX: ${receipt.transactionHash}`)

    this.safeSdk = await Safe.init({
      provider: this.providerUrl,
      signer: this._getPrivateKey(),
      safeAddress: this.address
    })

    if (this.storage) {
      await this.storage.saveMultisigInfo({
        address: this.address,
        owners,
        threshold,
        type: 'safe',
        network: this.network,
        createdBy: signerAddress,
        createdAt: Date.now()
      })
      console.log('Saved to storage')
    }

    return {
      address: this.address,
      owners,
      threshold
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // IMPORT EXISTING SAFE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Imports an existing Safe multisig wallet
   * 
   * @param {string} address - The Safe contract address
   * @returns {Promise<{address: string, owners: string[], threshold: number}>}
   * 
   */
  async import(address) {
    console.log(`Importing Safe at: ${address}`)

    if (!ethers.utils.isAddress(address)) {
      throw new Error('Invalid Ethereum address')
    }

    this.safeSdk = await Safe.init({
      provider: this.providerUrl,
      signer: this._getPrivateKey(),
      safeAddress: address
    })

    this.address = address
    this.owners = await this.safeSdk.getOwners()
    this.threshold = await this.safeSdk.getThreshold()

    console.log(`   Imported Safe: ${this.address}`)
    console.log(`   Owners: ${this.owners.length}`)
    console.log(`   Threshold: ${this.threshold}`)

    const signerAddress = await this.getSignerAddress()
    const isOwner = this.owners.some(
      owner => owner.toLowerCase() === signerAddress.toLowerCase()
    )
    if (!isOwner) {
      console.log(`   Warning: Signer ${signerAddress} is not an owner of this Safe`)
    }

    if (this.storage) {
      await this.storage.saveMultisigInfo({
        address: this.address,
        owners: this.owners,
        threshold: this.threshold,
        type: 'safe',
        network: this.network,
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
   * Proposes a new transaction
   * 
   * @param {Object} transaction - Transaction to propose
   * @param {string} transaction.to - Recipient address
   * @param {string} [transaction.value] - Value in wei
   * @param {string} [transaction.data] - Transaction data
   * @returns {Promise<string>} Proposal ID
   * 
   */
  async propose(transaction) {
    if (!this.safeSdk) {
      throw new Error('Safe not initialized. Call create() or import() first.')
    }

    console.log('Creating transaction proposal')
    console.log('  To:', transaction.to)
    console.log('  Value:', transaction.value || '0')

    const safeTransaction = await this.safeSdk.createTransaction({
      transactions: [{
        to: transaction.to,
        value: transaction.value || '0',
        data: transaction.data || '0x'
      }]
    })

    const safeTxHash = await this.safeSdk.getTransactionHash(safeTransaction)

    const signature = await this.safeSdk.signHash(safeTxHash)

    const signerAddress = await this.getSignerAddress()
    console.log(`   Proposal created`)
    console.log(`   Safe TX Hash: ${safeTxHash}`)
    console.log(`   Signed by: ${signerAddress}`)

    const proposalId = safeTxHash.slice(0, 18)

    if (this.storage) {
      await this.storage.saveProposal({
        id: proposalId,
        safeTxHash,
        multisigAddress: this.address,
        transaction: {
          to: transaction.to,
          value: transaction.value || '0',
          data: transaction.data || '0x'
        },
        safeTransaction: safeTransaction.data,
        signatures: [{
          signer: signerAddress,
          signature: signature.data,
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
    if (!this.safeSdk) {
      throw new Error('Safe not initialized')
    }

    console.log(`Signing proposal: ${proposalId}`)

    if (!this.storage) {
      throw new Error('Storage not configured')
    }

    const proposal = await this.storage.getProposal(proposalId)
    if (!proposal) {
      throw new Error(`Proposal not found: ${proposalId}`)
    }

    const signerAddress = await this.getSignerAddress()
    const alreadySigned = proposal.signatures.some(
      sig => sig.signer.toLowerCase() === signerAddress.toLowerCase()
    )
    if (alreadySigned) {
      console.log('   Already signed by this signer')
      return
    }

    const signature = await this.safeSdk.signHash(proposal.safeTxHash)

    console.log(`Signed by: ${signerAddress}`)

    if (this.storage) {
      await this.storage.saveProposal({
        ...proposal,
        signatures: [
          ...proposal.signatures,
          {
            signer: signerAddress,
            signature: signature.data,
            signedAt: Date.now()
          }
        ]
      })
      console.log('Signature saved to storage')
    }

    const sigCount = proposal.signatures.length + 1
    console.log(`   Signatures: ${sigCount}/${this.threshold}`)

    if (sigCount >= this.threshold) {
      console.log('   Threshold met! Ready to execute.')
    }
  }

  /**
   * Executes a proposal that has enough signatures
   * 
   * @param {string} proposalId - The proposal ID to execute
   * @returns {Promise<{success: boolean, txHash: string, blockNumber: string}>}
   */
  async execute(proposalId) {
    if (!this.safeSdk) {
      throw new Error('Safe not initialized')
    }

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

    console.log('Combining signatures...')

    const safeTransaction = await this.safeSdk.createTransaction({
      transactions: [{
        to: proposal.transaction.to,
        value: proposal.transaction.value,
        data: proposal.transaction.data
      }]
    })

    for (const sig of proposal.signatures) {
      safeTransaction.addSignature({
        signer: sig.signer,
        data: sig.signature
      })
    }

    console.log('Broadcasting transaction...')

    const txResponse = await this.safeSdk.executeTransaction(safeTransaction)
    const receipt = await txResponse.transactionResponse.wait()

    console.log('Transaction executed!')
    console.log(`   TX Hash: ${receipt.transactionHash}`)
    console.log(`   Block: ${receipt.blockNumber}`)

    const explorerUrls = {
      mainnet: 'https://etherscan.io',
      sepolia: 'https://sepolia.etherscan.io',
      polygon: 'https://polygonscan.com',
      arbitrum: 'https://arbiscan.io'
    }
    const explorer = explorerUrls[this.network] || explorerUrls.sepolia
    console.log(`🔗 View: ${explorer}/tx/${receipt.transactionHash}`)

    if (this.storage) {
      const signerAddress = await this.getSignerAddress()
      await this.storage.updateProposalStatus(proposalId, {
        status: 'executed',
        txHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber.toString(),
        executedAt: Date.now(),
        executedBy: signerAddress
      })
    }

    return {
      success: true,
      txHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber.toString()
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // QUERIES
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Gets the Safe multisig address
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
   * Gets the ETH or ERC20 token balance of the Safe
   * 
   * @param {string} [tokenAddress] - ERC20 token address (omit for ETH)
   * @returns {Promise<bigint>} Balance in wei or token units
   */
  async getBalance(tokenAddress) {
    if (!this.address) {
      throw new Error('Multisig not initialized')
    }

    const provider = new ethers.providers.JsonRpcProvider(this.providerUrl)

    if (!tokenAddress) {
      return await provider.getBalance(this.address)
    } else {
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ['function balanceOf(address) view returns (uint256)'],
        provider
      )
      return await tokenContract.balanceOf(this.address)
    }
  }

  /**
   * Gets pending proposals from storage
   * @returns {Promise<Object[]>} Array of pending proposals
   */
  async getPendingProposals() {
    if (!this.storage) {
      throw new Error('Storage not configured')
    }

    return await this.storage.listProposals(this.address, { status: 'pending' })
  }

  // ════════════════════════════════════════════════════════════════════════════
  // OWNER & THRESHOLD MANAGEMENT
  // ════════════════════════════════════════════════════════════════════════════

  /**
 * Refresh Safe info from blockchain (owners, threshold)
 * @private
 */
  async _refreshSafeInfo() {
    if (!this.safeSdk) {
      throw new Error('Safe not initialized')
    }

    this.owners = (await this.safeSdk.getOwners()).map(addr => addr.toLowerCase())
    this.threshold = await this.safeSdk.getThreshold()
  }

  /**
   * Change the threshold of the Safe
   * @param {number} newThreshold - New threshold (must be <= number of owners)
   * @returns {Promise<string>}
   */
  async changeThreshold(newThreshold) {
    if (!this.safeSdk) {
      throw new Error('Safe not initialized. Call import() first.')
    }

    await this._refreshSafeInfo()

    if (newThreshold < 1) {
      throw new Error('Threshold must be at least 1')
    }

    if (newThreshold > this.owners.length) {
      throw new Error(`Threshold ${newThreshold} exceeds number of owners ${this.owners.length}`)
    }

    console.log(`\n📝 Proposing threshold change: ${this.threshold} → ${newThreshold}`)

    const safeTransaction = await this.safeSdk.createChangeThresholdTx(newThreshold)
    const safeTxHash = await this.safeSdk.getTransactionHash(safeTransaction)

    const signature = await this.safeSdk.signHash(safeTxHash)
    const signerAddress = await this.getSignerAddress()

    const proposalId = safeTxHash.slice(0, 16)

    console.log(`Proposal ID: ${proposalId}`)
    console.log(`Safe TX Hash: ${safeTxHash}`)
    console.log(`Signer: ${signerAddress}`)

    if (this.storage) {
      await this.storage.saveProposal({
        id: proposalId,
        safeTxHash,
        multisigAddress: this.address,
        transaction: {
          to: this.address,
          value: '0',
          data: safeTransaction.data.data,
          operation: 'changeThreshold'
        },
        safeTransaction: safeTransaction.data,
        signatures: [{
          signer: signerAddress,
          signature: signature.data,
          signedAt: Date.now()
        }],
        status: 'pending',
        createdAt: Date.now(),
        createdBy: signerAddress,
        metadata: {
          action: 'changeThreshold',
          oldThreshold: this.threshold,
          newThreshold: newThreshold
        }
      })
      console.log('Saved to storage')
    }

    return proposalId
  }

  /**
   * Add a new owner to the Safe
   * @param {string} ownerAddress - Address of the new owner
   * @param {number} [newThreshold] - Optional new threshold (defaults to current threshold)
   * @returns {Promise<string>}
   */
  async addOwner(ownerAddress, newThreshold) {
    if (!this.safeSdk) {
      throw new Error('Safe not initialized. Call import() first.')
    }

    await this._refreshSafeInfo()

    if (!ethers.utils.isAddress(ownerAddress)) {
      throw new Error('Invalid owner address')
    }

    if (this.owners.includes(ownerAddress.toLowerCase())) {
      throw new Error('Address is already an owner')
    }

    const threshold = newThreshold !== undefined ? newThreshold : this.threshold

    if (threshold < 1 || threshold > this.owners.length + 1) {
      throw new Error(`Invalid threshold: ${threshold}. Must be between 1 and ${this.owners.length + 1}`)
    }

    console.log(`\n Proposing add owner: ${ownerAddress}`)
    console.log(`   New threshold: ${threshold}`)

    const safeTransaction = await this.safeSdk.createAddOwnerTx({
      ownerAddress,
      threshold
    })
    const safeTxHash = await this.safeSdk.getTransactionHash(safeTransaction)

    const signature = await this.safeSdk.signHash(safeTxHash)
    const signerAddress = await this.getSignerAddress()

    const proposalId = safeTxHash.slice(0, 16)

    console.log(`Proposal ID: ${proposalId}`)
    console.log(`Safe TX Hash: ${safeTxHash}`)
    console.log(`Signer: ${signerAddress}`)

    if (this.storage) {
      await this.storage.saveProposal({
        id: proposalId,
        safeTxHash,
        multisigAddress: this.address,
        transaction: {
          to: this.address,
          value: '0',
          data: safeTransaction.data.data,
          operation: 'addOwner'
        },
        safeTransaction: safeTransaction.data,
        signatures: [{
          signer: signerAddress,
          signature: signature.data,
          signedAt: Date.now()
        }],
        status: 'pending',
        createdAt: Date.now(),
        createdBy: signerAddress,
        metadata: {
          action: 'addOwner',
          newOwner: ownerAddress,
          oldThreshold: this.threshold,
          newThreshold: threshold,
          oldOwnersCount: this.owners.length,
          newOwnersCount: this.owners.length + 1
        }
      })
      console.log('Saved to storage')
    }

    return proposalId
  }

  /**
   * Remove an owner from the Safe
   * @param {string} ownerAddress - Address of the owner to remove
   * @param {number} [newThreshold] - Optional new threshold (defaults to current threshold, adjusted if needed)
   * @returns {Promise<string>}
   */
  async removeOwner(ownerAddress, newThreshold) {
    if (!this.safeSdk) {
      throw new Error('Safe not initialized. Call import() first.')
    }

    await this._refreshSafeInfo()

    if (!ethers.utils.isAddress(ownerAddress)) {
      throw new Error('Invalid owner address')
    }

    if (!this.owners.includes(ownerAddress.toLowerCase())) {
      throw new Error('Address is not an owner')
    }

    if (this.owners.length === 1) {
      throw new Error('Cannot remove the last owner')
    }

    const newOwnersCount = this.owners.length - 1
    let threshold = newThreshold !== undefined ? newThreshold : this.threshold

    if (threshold > newOwnersCount) {
      threshold = newOwnersCount
      console.log(` Threshold adjusted to ${threshold} (max for ${newOwnersCount} owners)`)
    }

    if (threshold < 1) {
      throw new Error('Threshold must be at least 1')
    }

    console.log(`\nProposing remove owner: ${ownerAddress}`)
    console.log(`   New threshold: ${threshold}`)

    const safeTransaction = await this.safeSdk.createRemoveOwnerTx({
      ownerAddress,
      threshold
    })
    const safeTxHash = await this.safeSdk.getTransactionHash(safeTransaction)

    const signature = await this.safeSdk.signHash(safeTxHash)
    const signerAddress = await this.getSignerAddress()

    const proposalId = safeTxHash.slice(0, 16)

    console.log(`Proposal ID: ${proposalId}`)
    console.log(`Safe TX Hash: ${safeTxHash}`)
    console.log(`Signer: ${signerAddress}`)

    if (this.storage) {
      await this.storage.saveProposal({
        id: proposalId,
        safeTxHash,
        multisigAddress: this.address,
        transaction: {
          to: this.address,
          value: '0',
          data: safeTransaction.data.data,
          operation: 'removeOwner'
        },
        safeTransaction: safeTransaction.data,
        signatures: [{
          signer: signerAddress,
          signature: signature.data,
          signedAt: Date.now()
        }],
        status: 'pending',
        createdAt: Date.now(),
        createdBy: signerAddress,
        metadata: {
          action: 'removeOwner',
          removedOwner: ownerAddress,
          oldThreshold: this.threshold,
          newThreshold: threshold,
          oldOwnersCount: this.owners.length,
          newOwnersCount: newOwnersCount
        }
      })
      console.log('Saved to storage')
    }

    return proposalId
  }
  // ════════════════════════════════════════════════════════════════════════════
  // MEMORY MANAGEMENT
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Disposes the manager, erasing the private key from memory
   */
  dispose() {
    if (this._ownerAccount) {
      this._ownerAccount.dispose()
    }
    this.safeSdk = null
  }
}

export default SafeMultisigEVM