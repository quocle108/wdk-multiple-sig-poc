'use strict'

import { Safe4337Pack } from '@wdk-safe-global/relay-kit'
import { ethers } from 'ethers'
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'
import { MultisigManager } from './MultisigManager.js'

/**
 * @typedef {Object} SafeMultisigEVM4337Config
 * @property {string} provider - RPC URL string
 * @property {string} bundlerUrl - Bundler URL (e.g., Pimlico)
 * @property {string} [paymasterUrl] - Paymaster URL (optional, defaults to bundlerUrl)
 * @property {string} [paymasterAddress] - Paymaster contract address (required for ERC-20 gas payment)
 * @property {string} [paymasterTokenAddress] - ERC-20 token address for gas payment (e.g., USDC)
 * @property {string} [defaultGasToken] - Default ERC-20 token for gas payment (deprecated, use paymasterTokenAddress)
 * @property {string} [network] - Network name ('sepolia', 'mainnet', etc.)
 * @property {string} [safeModulesVersion] - Safe modules version ('0.2.0' for EntryPoint v0.6, '0.3.0' for v0.7)
 * @property {StorageAdapter} [storage] - Storage adapter instance
 */

/**
 * SafeMultisigEVM4337 - Manages Safe multisig wallets via ERC-4337 (Account Abstraction)
 * 
 * Key differences from SafeMultisigEVM:
 * - All transactions go through bundler (no direct execution)
 * - Gas can be paid in ERC-20 tokens (USDT, USDC) via paymaster
 * - First transaction deploys the Safe (counterfactual deployment)
 * - Owners sign SafeOperation hash (not SafeTransaction hash)
 * 
 * @extends MultisigManager
 */
export class SafeMultisigEVM4337 extends MultisigManager {
  /**
   * Creates a new Safe 4337 multisig manager
   * 
   * @param {string | Uint8Array} seed - BIP-39 seed phrase or seed bytes
   * @param {string} path - BIP-44 derivation path (e.g. "0'/0/0")
   * @param {SafeMultisigEVM4337Config} config - Configuration object
   */
  constructor(seed, path, config) {
    const ownerAccount = new WalletAccountEvm(seed, path, {
      provider: config.provider
    })

    super(ownerAccount, config)

    this.providerUrl = config.provider
    this.network = config.network || 'sepolia'
    
    this.bundlerUrl = config.bundlerUrl
    this.paymasterUrl = config.paymasterUrl || config.bundlerUrl
    this.paymasterAddress = config.paymasterAddress || null
    this.paymasterTokenAddress = config.paymasterTokenAddress || null
    this.defaultGasToken = config.defaultGasToken || config.paymasterTokenAddress || null
    
    this.safeModulesVersion = config.safeModulesVersion || '0.3.0'
    this.safe4337Pack = null
    this._isDeployed = null
    this._saltNonce = null
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ACCOUNT INFO
  // ════════════════════════════════════════════════════════════════════════════

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

  // ════════════════════════════════════════════════════════════════════════════
  // CREATE SAFE (COUNTERFACTUAL)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Creates a new Safe multisig wallet (counterfactual - not deployed until first tx)
   * 
   * @param {string[]} owners - Array of owner addresses
   * @param {number} threshold - Number of signatures required
   * @param {Object} [options] - Optional parameters
   * @param {string} [options.saltNonce] - Salt nonce for deterministic address
   * @returns {Promise<{address: string, owners: string[], threshold: number, isDeployed: boolean}>}
   */
  async create(owners, threshold, options = {}) {
    console.log(`Creating Safe 4337 multisig: ${threshold}-of-${owners.length}`)

    if (owners.length < 1) {
      throw new Error('Need at least 1 owner')
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

    this._saltNonce = options.saltNonce || this._generateDeterministicNonce(owners, threshold)

    const paymasterOptions = this._buildPaymasterOptions()

    this.safe4337Pack = await Safe4337Pack.init({
      provider: this.providerUrl,
      signer: this._getPrivateKey(),
      bundlerUrl: this.bundlerUrl,
      safeModulesVersion: this.safeModulesVersion,
      options: {
        owners: owners,
        threshold: threshold,
        saltNonce: this._saltNonce
      },
      ...(paymasterOptions && { paymasterOptions })
    })

    this.address = await this.safe4337Pack.protocolKit.getAddress()
    this.owners = owners
    this.threshold = threshold

    this._isDeployed = await this.isDeployed()

    console.log(`Safe 4337 address: ${this.address}`)
    console.log(`   Deployed: ${this._isDeployed}`)
    console.log(`   Network: ${this.network}`)
    console.log(`   EntryPoint version: ${this.safeModulesVersion === '0.3.0' ? 'v0.7' : 'v0.6'}`)

    if (this.storage) {
      await this.storage.saveMultisigInfo({
        address: this.address,
        owners,
        threshold,
        type: 'safe-4337',
        network: this.network,
        saltNonce: this._saltNonce,
        safeModulesVersion: this.safeModulesVersion,
        isDeployed: this._isDeployed,
        createdBy: signerAddress,
        createdAt: Date.now()
      })
      console.log('Saved to storage')
    }

    return {
      address: this.address,
      owners,
      threshold,
      isDeployed: this._isDeployed
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // IMPORT EXISTING SAFE
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Imports an existing Safe multisig wallet for 4337 operations
   * 
   * Handles both deployed and counterfactual (not yet deployed) Safes:
   * - Deployed: Uses safeAddress to load from chain
   * - Counterfactual: Uses owners/threshold/saltNonce from storage
   * 
   * @param {string} address - The Safe contract address
   * @returns {Promise<{address: string, owners: string[], threshold: number, isDeployed: boolean}>}
   */
  async import(address) {
    console.log(`Importing Safe 4337 at: ${address}`)

    if (!ethers.utils.isAddress(address)) {
      throw new Error('Invalid Ethereum address')
    }

    const provider = new ethers.providers.JsonRpcProvider(this.providerUrl)
    const code = await provider.getCode(address)
    const isDeployed = code !== '0x'

    const paymasterOptions = this._buildPaymasterOptions()

    if (isDeployed) {
      console.log('   Safe is deployed, loading from chain...')
      
      this.safe4337Pack = await Safe4337Pack.init({
        provider: this.providerUrl,
        signer: this._getPrivateKey(),
        bundlerUrl: this.bundlerUrl,
        safeModulesVersion: this.safeModulesVersion,
        options: {
          safeAddress: address
        },
        ...(paymasterOptions && { paymasterOptions })
      })

      this.address = address
      this.owners = await this.safe4337Pack.protocolKit.getOwners()
      this.threshold = await this.safe4337Pack.protocolKit.getThreshold()
      this._isDeployed = true

    } else {
      console.log('   Safe is counterfactual (not deployed), loading from storage...')
      
      if (!this.storage) {
        throw new Error('Storage required to import counterfactual Safe. Provide owners/threshold/saltNonce or use storage.')
      }

      const storedInfo = await this.storage.getMultisigInfo(address)
      if (!storedInfo) {
        throw new Error(`Counterfactual Safe not found in storage: ${address}. The Safe creator must share the configuration.`)
      }

      if (!storedInfo.owners || !storedInfo.threshold || !storedInfo.saltNonce) {
        throw new Error('Storage missing required fields for counterfactual Safe: owners, threshold, saltNonce')
      }

      this.safe4337Pack = await Safe4337Pack.init({
        provider: this.providerUrl,
        signer: this._getPrivateKey(),
        bundlerUrl: this.bundlerUrl,
        safeModulesVersion: storedInfo.safeModulesVersion || this.safeModulesVersion,
        options: {
          owners: storedInfo.owners,
          threshold: storedInfo.threshold,
          saltNonce: storedInfo.saltNonce
        },
        ...(paymasterOptions && { paymasterOptions })
      })

      const predictedAddress = await this.safe4337Pack.protocolKit.getAddress()
      if (predictedAddress.toLowerCase() !== address.toLowerCase()) {
        throw new Error(`Address mismatch! Expected ${address}, got ${predictedAddress}. Salt nonce or owners may be incorrect.`)
      }

      this.address = address
      this.owners = storedInfo.owners
      this.threshold = storedInfo.threshold
      this._saltNonce = storedInfo.saltNonce
      this._isDeployed = false
    }

    console.log(`Imported Safe 4337: ${this.address}`)
    console.log(`   Owners: ${this.owners.length}`)
    console.log(`   Threshold: ${this.threshold}`)
    console.log(`   Deployed: ${this._isDeployed}`)

    const signerAddress = await this.getSignerAddress()
    const isOwner = this.owners.some(
      owner => owner.toLowerCase() === signerAddress.toLowerCase()
    )
    if (!isOwner) {
      console.log(`   ⚠️ Warning: Signer ${signerAddress} is not an owner of this Safe`)
    }

    if (this.storage) {
      const existingInfo = await this.storage.getMultisigInfo(address) || {}
      await this.storage.saveMultisigInfo({
        ...existingInfo,
        address: this.address,
        owners: this.owners,
        threshold: this.threshold,
        type: 'safe-4337',
        network: this.network,
        safeModulesVersion: this.safeModulesVersion,
        isDeployed: this._isDeployed,
        importedBy: signerAddress,
        importedAt: Date.now()
      })
    }

    return {
      address: this.address,
      owners: this.owners,
      threshold: this.threshold,
      isDeployed: this._isDeployed
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TRANSACTION OPERATIONS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Proposes a new transaction
   * 
   * Creates a SafeOperation with current gas estimates.
   * All signers must sign the same SafeOperation hash.
   * 
   * @param {Object} transaction - Transaction to propose
   * @param {string} transaction.to - Recipient address
   * @param {string} [transaction.value] - Value in wei
   * @param {string} [transaction.data] - Transaction data
   * @param {Object} [options] - Optional parameters
   * @param {string} [options.gasToken] - ERC-20 token address for gas payment (undefined = use default)
   * @param {bigint} [options.amountToApprove] - Amount to approve for paymaster (if needed)
   * @returns {Promise<string>} Proposal ID
   */
  async propose(transaction, options = {}) {
    if (!this.safe4337Pack) {
      throw new Error('Safe not initialized. Call create() or import() first.')
    }

    console.log('Creating 4337 transaction proposal')
    console.log('   To:', transaction.to)
    console.log('   Value:', transaction.value || '0')

    const gasToken = options.gasToken !== undefined ? options.gasToken : this.defaultGasToken

    if (gasToken && gasToken !== this.defaultGasToken) {
      await this._reinitializeWithGasToken(gasToken, options.amountToApprove)
    }

    const safeOperation = await this.safe4337Pack.createTransaction({
      transactions: [{
        to: transaction.to,
        value: transaction.value || '0',
        data: transaction.data || '0x'
      }],
      options: {
        amountToApprove: options.amountToApprove
      }
    })

    const userOp = safeOperation.userOperation
    
    // IMPORTANT: Add gas buffer for multisig signature verification
    // The SDK estimates with 1 dummy signature, but we need gas for `threshold` signatures
    // Each additional signature verification costs ~30k gas
    const additionalSigners = this.threshold - 1
    if (additionalSigners > 0) {
      const currentVerificationGas = BigInt(userOp.verificationGasLimit || 0)
      const gasPerAdditionalSigner = BigInt(30000) // ~30k per signer
      const additionalGas = gasPerAdditionalSigner * BigInt(additionalSigners)
      userOp.verificationGasLimit = currentVerificationGas + additionalGas
    }

    const safeOpHash = safeOperation.getHash()

    const signedSafeOperation = await this.safe4337Pack.signSafeOperation(safeOperation)

    const signerAddress = await this.getSignerAddress()
    
    const proposalId = safeOpHash.slice(0, 18)

    console.log(`   Proposal created`)
    console.log(`   SafeOp Hash: ${safeOpHash}`)
    console.log(`   Proposal ID: ${proposalId}`)
    console.log(`   Signed by: ${signerAddress}`)
    console.log(`   Gas Token: ${gasToken || 'ETH (native)'}`)

    if (this.storage) {
      const signatures = this._extractSignatures(signedSafeOperation)

      await this.storage.saveProposal({
        id: proposalId,
        safeOpHash,
        multisigAddress: this.address,
        
        transaction: {
          to: transaction.to,
          value: transaction.value || '0',
          data: transaction.data || '0x'
        },
        
        safeOperationData: this._serializeSafeOperation(safeOperation),
        
        signatures: [{
          signer: signerAddress,
          signature: signatures[signerAddress.toLowerCase()],
          signedAt: Date.now()
        }],
        
        gasToken: gasToken || null,
        chainId: await this._getChainId(),
        moduleAddress: this.safe4337Pack.protocolKit.getAddress(),
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
    if (!this.safe4337Pack) {
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

    if (proposal.status !== 'pending') {
      throw new Error(`Proposal is ${proposal.status}, cannot sign`)
    }

    const signerAddress = await this.getSignerAddress()
    const alreadySigned = proposal.signatures.some(
      sig => sig.signer.toLowerCase() === signerAddress.toLowerCase()
    )
    if (alreadySigned) {
      console.log('   Already signed by this signer')
      return
    }

    const storedData = proposal.safeOperationData

    if (storedData.paymaster && proposal.gasToken) {
      console.log('   Reinitializing with paymaster for correct SafeOperation type...')
      await this._reinitializeWithGasToken(proposal.gasToken)
    }
    
    const safeOperation = await this.safe4337Pack.createTransaction({
      transactions: [proposal.transaction]
    })
    
    // Override all fields with stored values
    const userOp = safeOperation.userOperation
    userOp.callData = storedData.callData
    userOp.nonce = BigInt(storedData.nonce || 0)
    userOp.callGasLimit = BigInt(storedData.callGasLimit || 0)
    userOp.verificationGasLimit = BigInt(storedData.verificationGasLimit || 0)
    userOp.preVerificationGas = BigInt(storedData.preVerificationGas || 0)
    userOp.maxFeePerGas = BigInt(storedData.maxFeePerGas || 0)
    userOp.maxPriorityFeePerGas = BigInt(storedData.maxPriorityFeePerGas || 0)
    
    if (storedData.paymaster) {
      userOp.paymaster = storedData.paymaster
      userOp.paymasterVerificationGasLimit = BigInt(storedData.paymasterVerificationGasLimit || 0)
      userOp.paymasterPostOpGasLimit = BigInt(storedData.paymasterPostOpGasLimit || 0)
      userOp.paymasterData = storedData.paymasterData
    }
    
    if (storedData.factory) {
      userOp.factory = storedData.factory
      userOp.factoryData = storedData.factoryData
    }
    
    if (storedData.options) {
      if (storedData.options.validAfter !== undefined) {
        safeOperation.options.validAfter = storedData.options.validAfter
      }
      if (storedData.options.validUntil !== undefined) {
        safeOperation.options.validUntil = storedData.options.validUntil
      }
    }
    
    const signedSafeOperation = await this.safe4337Pack.signSafeOperation(safeOperation)
    
    const signatures = this._extractSignatures(signedSafeOperation)
    const signature = signatures[signerAddress.toLowerCase()]
    
    if (!signature) {
      throw new Error('Failed to extract signature')
    }

    console.log(`   Signed by: ${signerAddress}`)

    await this.storage.saveProposal({
      ...proposal,
      signatures: [
        ...proposal.signatures,
        {
          signer: signerAddress,
          signature: signature,
          signedAt: Date.now()
        }
      ]
    })
    console.log('   Signature saved to storage')

    const sigCount = proposal.signatures.length + 1
    console.log(`   Signatures: ${sigCount}/${this.threshold}`)

    if (sigCount >= this.threshold) {
      console.log('   ✅ Threshold met! Ready to execute.')
    }
  }

  /**
   * Executes a proposal that has enough signatures
   * 
   * @param {string} proposalId - The proposal ID to execute
   * @param {Object} [options] - Optional parameters
   * @param {string} [options.gasToken] - Override gas token for execution
   * @returns {Promise<{success: boolean, userOpHash: string, txHash?: string}>}
   */
  async execute(proposalId, options = {}) {
    if (!this.safe4337Pack) {
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

    console.log('   Combining signatures...')

    const storedData = proposal.safeOperationData

    const safeOperation = await this.safe4337Pack.createTransaction({
      transactions: [proposal.transaction]
    })

    const userOp = safeOperation.userOperation
    
    userOp.callData = storedData.callData
    
    userOp.nonce = BigInt(storedData.nonce || 0)
    userOp.callGasLimit = BigInt(storedData.callGasLimit || 0)
    userOp.verificationGasLimit = BigInt(storedData.verificationGasLimit || 0)
    userOp.preVerificationGas = BigInt(storedData.preVerificationGas || 0)
    userOp.maxFeePerGas = BigInt(storedData.maxFeePerGas || 0)
    userOp.maxPriorityFeePerGas = BigInt(storedData.maxPriorityFeePerGas || 0)
    
    if (storedData.factory) {
      userOp.factory = storedData.factory
      userOp.factoryData = storedData.factoryData
    }
    if (storedData.initCode && storedData.initCode !== '0x') {
      userOp.initCode = storedData.initCode
    }
    
    if (storedData.paymaster) {
      userOp.paymaster = storedData.paymaster
      userOp.paymasterVerificationGasLimit = BigInt(storedData.paymasterVerificationGasLimit || 0)
      userOp.paymasterPostOpGasLimit = BigInt(storedData.paymasterPostOpGasLimit || 0)
      userOp.paymasterData = storedData.paymasterData
    }

    for (const sig of proposal.signatures) {
      safeOperation.signatures.set(sig.signer.toLowerCase(), {
        signer: sig.signer,
        data: sig.signature,
        isContractSignature: false
      })
    }

    console.log('   Submitting to bundler...')

    const userOpHash = await this.safe4337Pack.executeTransaction({
      executable: safeOperation
    })

    console.log(`   UserOp Hash: ${userOpHash}`)

    console.log('   Waiting for confirmation...')
    let receipt = null
    let attempts = 0
    const maxAttempts = 60

    while (!receipt && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000))
      try {
        receipt = await this.safe4337Pack.getUserOperationReceipt(userOpHash)
      } catch (e) {
        // Not ready yet
      }
      attempts++
    }

    if (!receipt) {
      console.log('   ⚠️ Transaction submitted but receipt not yet available')
      console.log(`   Track at: https://jiffyscan.xyz/userOpHash/${userOpHash}`)
      
      const signerAddress = await this.getSignerAddress()
      await this.storage.updateProposalStatus(proposalId, {
        status: 'submitted',
        userOpHash,
        submittedAt: Date.now(),
        submittedBy: signerAddress
      })

      return {
        success: true,
        userOpHash,
        txHash: null
      }
    }

    const txHash = receipt.receipt?.transactionHash || receipt.transactionHash

    console.log('   ✅ Transaction included on-chain!')
    console.log(`   TX Hash: ${txHash}`)
    console.log(`   Inner call success: ${receipt.success}`)

    this._isDeployed = true

    const signerAddress = await this.getSignerAddress()
    await this.storage.updateProposalStatus(proposalId, {
      status: receipt.success ? 'executed' : 'failed',
      userOpHash,
      txHash,
      gasUsed: receipt.actualGasUsed?.toString(),
      gasCost: receipt.actualGasCost?.toString(),
      executedAt: Date.now(),
      executedBy: signerAddress
    })

    await this.storage.saveMultisigInfo({
      address: this.address,
      owners: this.owners,
      threshold: this.threshold,
      type: 'safe-4337',
      network: this.network,
      isDeployed: true,
      lastTxHash: txHash,
      lastTxAt: Date.now()
    })

    return {
      success: receipt.success,
      userOpHash,
      txHash
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // QUERIES
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Check if Safe is deployed on-chain
   * @returns {Promise<boolean>}
   */
  async isDeployed() {
    if (!this.address) {
      throw new Error('Safe not initialized')
    }

    const provider = new ethers.providers.JsonRpcProvider(this.providerUrl)
    const code = await provider.getCode(this.address)
    return code !== '0x'
  }

  /**
   * Gets the ETH balance of the Safe
   * @returns {Promise<ethers.BigNumber>}
   */
  async getBalance() {
    if (!this.address) {
      throw new Error('Safe not initialized')
    }

    const provider = new ethers.providers.JsonRpcProvider(this.providerUrl)
    return await provider.getBalance(this.address)
  }

  /**
   * Gets ERC-20 token balance of the Safe
   * @param {string} tokenAddress - Token contract address
   * @returns {Promise<ethers.BigNumber>}
   */
  async getTokenBalance(tokenAddress) {
    if (!this.address) {
      throw new Error('Safe not initialized')
    }

    const provider = new ethers.providers.JsonRpcProvider(this.providerUrl)
    const tokenContract = new ethers.Contract(
      tokenAddress,
      ['function balanceOf(address) view returns (uint256)'],
      provider
    )
    return await tokenContract.balanceOf(this.address)
  }

  /**
   * Estimate fee for a transaction
   * @param {Object} transaction - Transaction to estimate
   * @param {Object} [options] - Options including gasToken
   * @returns {Promise<{fee: string, token: string|null}>}
   */
  async estimateFee(transaction, options = {}) {
    if (!this.safe4337Pack) {
      throw new Error('Safe not initialized')
    }

    const gasToken = options.gasToken !== undefined ? options.gasToken : this.defaultGasToken

    const safeOperation = await this.safe4337Pack.createTransaction({
      transactions: [{
        to: transaction.to,
        value: transaction.value || '0',
        data: transaction.data || '0x'
      }]
    })

    const userOp = safeOperation.userOperation
    
    const totalGas = BigInt(userOp?.callGasLimit || 0) + 
                     BigInt(userOp?.verificationGasLimit || 0) + 
                     BigInt(userOp?.preVerificationGas || 0)
    
    const maxFeePerGas = BigInt(userOp?.maxFeePerGas || 0)
    const estimatedFee = totalGas * maxFeePerGas

    return {
      fee: estimatedFee.toString(),
      feeFormatted: ethers.utils.formatEther(estimatedFee),
      token: gasToken,
      gasDetails: {
        callGasLimit: userOp?.callGasLimit?.toString(),
        verificationGasLimit: userOp?.verificationGasLimit?.toString(),
        preVerificationGas: userOp?.preVerificationGas?.toString(),
        maxFeePerGas: userOp?.maxFeePerGas?.toString(),
        maxPriorityFeePerGas: userOp?.maxPriorityFeePerGas?.toString()
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // OWNER MANAGEMENT (via bundler)
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Add a new owner to the Safe
   * @param {string} ownerAddress - Address of the new owner
   * @param {number} [newThreshold] - Optional new threshold
   * @returns {Promise<string>} Proposal ID
   */
  async addOwner(ownerAddress, newThreshold) {
    if (!this.safe4337Pack) {
      throw new Error('Safe not initialized')
    }

    if (!ethers.utils.isAddress(ownerAddress)) {
      throw new Error('Invalid owner address')
    }

    const currentOwners = await this.safe4337Pack.protocolKit.getOwners()
    if (currentOwners.map(o => o.toLowerCase()).includes(ownerAddress.toLowerCase())) {
      throw new Error('Address is already an owner')
    }

    const threshold = newThreshold !== undefined ? newThreshold : this.threshold

    console.log(`\n📝 Proposing add owner: ${ownerAddress}`)
    console.log(`   New threshold: ${threshold}`)

    const addOwnerTx = await this.safe4337Pack.protocolKit.createAddOwnerTx({
      ownerAddress,
      threshold
    })

    return await this.propose({
      to: this.address,
      value: '0',
      data: addOwnerTx.data.data
    })
  }

  /**
   * Remove an owner from the Safe
   * @param {string} ownerAddress - Address of the owner to remove
   * @param {number} [newThreshold] - Optional new threshold
   * @returns {Promise<string>} Proposal ID
   */
  async removeOwner(ownerAddress, newThreshold) {
    if (!this.safe4337Pack) {
      throw new Error('Safe not initialized')
    }

    if (!ethers.utils.isAddress(ownerAddress)) {
      throw new Error('Invalid owner address')
    }

    const currentOwners = await this.safe4337Pack.protocolKit.getOwners()
    if (!currentOwners.map(o => o.toLowerCase()).includes(ownerAddress.toLowerCase())) {
      throw new Error('Address is not an owner')
    }

    if (currentOwners.length === 1) {
      throw new Error('Cannot remove the last owner')
    }

    const newOwnersCount = currentOwners.length - 1
    let threshold = newThreshold !== undefined ? newThreshold : this.threshold

    if (threshold > newOwnersCount) {
      threshold = newOwnersCount
      console.log(`   ⚠️ Threshold adjusted to ${threshold} (max for ${newOwnersCount} owners)`)
    }

    console.log(`\n📝 Proposing remove owner: ${ownerAddress}`)
    console.log(`   New threshold: ${threshold}`)

    const removeOwnerTx = await this.safe4337Pack.protocolKit.createRemoveOwnerTx({
      ownerAddress,
      threshold
    })

    return await this.propose({
      to: this.address,
      value: '0',
      data: removeOwnerTx.data.data
    })
  }

  /**
   * Change the threshold of the Safe
   * @param {number} newThreshold - New threshold
   * @returns {Promise<string>} Proposal ID
   */
  async changeThreshold(newThreshold) {
    if (!this.safe4337Pack) {
      throw new Error('Safe not initialized')
    }

    const currentOwners = await this.safe4337Pack.protocolKit.getOwners()

    if (newThreshold < 1 || newThreshold > currentOwners.length) {
      throw new Error(`Threshold must be between 1 and ${currentOwners.length}`)
    }

    console.log(`\n📝 Proposing threshold change: ${this.threshold} → ${newThreshold}`)

    const changeThresholdTx = await this.safe4337Pack.protocolKit.createChangeThresholdTx(newThreshold)

    return await this.propose({
      to: this.address,
      value: '0',
      data: changeThresholdTx.data.data
    })
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ════════════════════════════════════════════════════════════════════════════

  /**
   * Generate a deterministic salt nonce from owners and threshold
   * This ensures the same owners + threshold always produces the same Safe address
   * @private
   * @param {string[]} owners - Array of owner addresses
   * @param {number} threshold - Signature threshold
   * @returns {string} Deterministic nonce (keccak256 hash)
   */
  _generateDeterministicNonce(owners, threshold) {
    const sortedOwners = [...owners].map(o => o.toLowerCase()).sort()
    const data = JSON.stringify({ owners: sortedOwners, threshold })
    return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(data))
  }

  /**
   * Build paymaster options for Safe4337Pack
   * @private
   */
  _buildPaymasterOptions() {
    if (!this.paymasterAddress) {
      return null
    }

    const options = {
      paymasterUrl: this.paymasterUrl,
      paymasterAddress: this.paymasterAddress
    }

    if (this.defaultGasToken) {
      options.paymasterTokenAddress = this.defaultGasToken
    }

    return options
  }

  /**
   * Reinitialize Safe4337Pack with different gas token
   * @private
   */
  async _reinitializeWithGasToken(gasToken, amountToApprove) {
    const paymasterOptions = {
      paymasterUrl: this.paymasterUrl,
      paymasterAddress: this.paymasterAddress,
      paymasterTokenAddress: gasToken
    }

    if (amountToApprove) {
      paymasterOptions.amountToApprove = amountToApprove
    }

    this.safe4337Pack = await Safe4337Pack.init({
      provider: this.providerUrl,
      signer: this._getPrivateKey(),
      bundlerUrl: this.bundlerUrl,
      safeModulesVersion: this.safeModulesVersion,
      options: {
        safeAddress: this.address
      },
      paymasterOptions
    })
  }

  /**
   * Get chain ID
   * @private
   */
  async _getChainId() {
    const provider = new ethers.providers.JsonRpcProvider(this.providerUrl)
    const network = await provider.getNetwork()
    return network.chainId
  }

  /**
   * Extract signatures from signed SafeOperation
   * @private
   */
  _extractSignatures(signedSafeOperation) {
    const signatures = {}
    
    if (signedSafeOperation.signatures) {
      for (const [signer, sig] of signedSafeOperation.signatures) {
        signatures[signer.toLowerCase()] = sig.data
      }
    }
    
    return signatures
  }

  /**
   * Serialize SafeOperation for storage
   * Stores all data needed to reconstruct the exact same operation
   * @private
   */
  _serializeSafeOperation(safeOperation) {
    const userOp = safeOperation.userOperation
    
    return {
      sender: userOp.sender,
      nonce: userOp.nonce?.toString() || '0',
      initCode: userOp.initCode || '0x',
      factory: userOp.factory || null,
      factoryData: userOp.factoryData || null,
      callData: userOp.callData || '0x',
      callGasLimit: userOp.callGasLimit?.toString() || '0',
      verificationGasLimit: userOp.verificationGasLimit?.toString() || '0',
      preVerificationGas: userOp.preVerificationGas?.toString() || '0',
      maxFeePerGas: userOp.maxFeePerGas?.toString() || '0',
      maxPriorityFeePerGas: userOp.maxPriorityFeePerGas?.toString() || '0',
      paymaster: userOp.paymaster || null,
      paymasterVerificationGasLimit: userOp.paymasterVerificationGasLimit?.toString() || '0',
      paymasterPostOpGasLimit: userOp.paymasterPostOpGasLimit?.toString() || '0',
      paymasterData: userOp.paymasterData || null,
      signature: userOp.signature || '0x',
      options: safeOperation.options || {}
    }
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
    this.safe4337Pack = null
  }
}

export default SafeMultisigEVM4337