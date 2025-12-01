'use strict'

import SafeApiKit from '@safe-global/api-kit'
import { Safe4337Pack } from '@safe-global/relay-kit'
import { ethers } from 'ethers'
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'
import { MultisigManager } from './MultisigManager.js'

/**
 * @typedef {Object} PaymasterOptions
 * Configuration for ERC-20 gas payment (pay gas with USDC, USDT, etc.)
 * 
 * @property {string} paymasterUrl - Paymaster URL for gas estimation (from Pimlico dashboard)
 * @property {string} paymasterAddress - Paymaster contract address (Pimlico: 0x6666666666667849c56f2850848ce1c4da65c68b)
 * @property {string} paymasterTokenAddress - ERC-20 token address for gas payment (e.g., USDC)
 * @property {bigint} [amountToApprove] - Amount to approve for paymaster (auto-batched with first tx)
 * 
 * @example
 * // ERC-20 Token Payment (USDC) - Zero ETH required!
 * const paymasterOptions = {
 *   paymasterUrl: 'https://api.pimlico.io/v2/sepolia/rpc?apikey=...',
 *   paymasterAddress: '0x6666666666667849c56f2850848ce1c4da65c68b',
 *   paymasterTokenAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',  // USDC Sepolia
 *   amountToApprove: 1000000000000n  // 1M USDC (6 decimals) - auto-batched with first tx
 * }
 */

/**
 * @typedef {Object} SafeMultisigEVM4337ApiConfig
 * @property {string} provider - RPC URL string (e.g., 'https://rpc.sepolia.org')
 * @property {bigint} chainId - Chain ID as BigInt (e.g., 11155111n for Sepolia)
 * @property {string} bundlerUrl - ERC-4337 Bundler URL (e.g., Pimlico)
 * @property {string} [safeApiKey] - Safe Transaction Service API key (optional, for higher rate limits)
 * @property {string} [txServiceUrl] - Custom Transaction Service URL (optional, auto-resolved by chainId)
 * @property {PaymasterOptions} [paymasterOptions] - ERC-20 gas payment config
 * @property {string} [safeModulesVersion='0.2.0'] - Safe modules version:
 *   - '0.2.0' → EntryPoint v0.6 (recommended, works with Safe API)
 *   - '0.3.0' → EntryPoint v0.7 (limited Safe API support)
 */

/**
 * SafeMultisigEVM4337Api - Safe 4337 multisig with Safe API Kit coordination
 * 
 * Uses Safe Transaction Service API for storing and coordinating SafeOperations
 * across multiple signers, with execution via ERC-4337 bundler.
 * 
 * @extends MultisigManager
 */
export class SafeMultisigEVM4337Api extends MultisigManager {
  constructor(seed, path, config) {
    const ownerAccount = new WalletAccountEvm(seed, path, {
      provider: config.provider
    })

    super(ownerAccount, config)
    
    this.providerUrl = config.provider
    this.chainId = config.chainId
    this.bundlerUrl = config.bundlerUrl
    this.paymasterOptions = config.paymasterOptions || null
    this.safeModulesVersion = config.safeModulesVersion || '0.2.0'
    
    const apiKitConfig = { chainId: this.chainId }
    if (config.txServiceUrl) {
      apiKitConfig.txServiceUrl = config.txServiceUrl
    }
    if (config.safeApiKey) {
      apiKitConfig.apiKey = config.safeApiKey
    }
    
    this.apiKit = new SafeApiKit(apiKitConfig)
    this.safe4337Pack = null
  }

  _getPrivateKey() {
    const privateKey = this._ownerAccount.keyPair.privateKey
    return '0x' + Buffer.from(privateKey).toString('hex')
  }

  _generateDeterministicNonce(owners, threshold) {
    const sortedOwners = [...owners].map(o => o.toLowerCase()).sort()
    const data = JSON.stringify({ owners: sortedOwners, threshold })
    return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(data))
  }

  /**
   * Create a new Safe (counterfactual - not deployed until first tx)
   * @param {string[]} owners - Array of owner addresses
   * @param {number} threshold - Number of required signatures
   * @param {string} [saltNonce] - Optional custom salt nonce
   */
  async create(owners, threshold, saltNonce = null) {
    console.log(`Creating new Safe 4337...`)
    console.log(`   Owners: ${owners.length}`)
    console.log(`   Threshold: ${threshold}`)
    console.log(`   Safe Modules Version: ${this.safeModulesVersion}`)

    const privateKey = this._getPrivateKey()
    const finalSaltNonce = saltNonce ?? this._generateDeterministicNonce(owners, threshold)

    console.log(`   Salt Nonce: ${String(finalSaltNonce).slice(0, 18)}...`)

    const initOptions = {
      provider: this.providerUrl,
      signer: privateKey,
      bundlerUrl: this.bundlerUrl,
      safeModulesVersion: this.safeModulesVersion,
      options: {
        owners: owners,
        threshold: threshold,
        saltNonce: finalSaltNonce
      }
    }

    if (this.paymasterOptions) {
      initOptions.paymasterOptions = this.paymasterOptions
    }

    console.log(`   Initializing Safe4337Pack...`)
    this.safe4337Pack = await Safe4337Pack.init(initOptions)

    this.address = await this.safe4337Pack.protocolKit.getAddress()
    this.owners = owners
    this.threshold = threshold

    const provider = new ethers.providers.JsonRpcProvider(this.providerUrl)
    const code = await provider.getCode(this.address)
    const isDeployed = code !== '0x'

    console.log(`   Predicted Address: ${this.address}`)
    console.log(`   Already Deployed: ${isDeployed}`)

    return {
      address: this.address,
      owners: this.owners,
      threshold: this.threshold,
      isDeployed,
      saltNonce: finalSaltNonce
    }
  }

  /**
   * Import an existing Safe (deployed or counterfactual)
   * @param {string} safeAddress - The Safe address to import
   * @param {Object} [predictedSafeConfig] - Config for counterfactual Safes
   * @param {string[]} predictedSafeConfig.owners - Owner addresses
   * @param {number} predictedSafeConfig.threshold - Required signatures
   * @param {string} [predictedSafeConfig.saltNonce] - Salt nonce used when creating
   */
  async import(safeAddress, predictedSafeConfig = null) {
    console.log(`Importing Safe: ${safeAddress}`)

    const privateKey = this._getPrivateKey()
    const provider = new ethers.providers.JsonRpcProvider(this.providerUrl)
    const code = await provider.getCode(safeAddress)
    const isDeployed = code !== '0x'

    console.log(`   Deployed: ${isDeployed}`)

    let initOptions = {
      provider: this.providerUrl,
      signer: privateKey,
      bundlerUrl: this.bundlerUrl,
      safeModulesVersion: this.safeModulesVersion
    }

    if (isDeployed) {
      initOptions.options = { safeAddress }
    } else if (predictedSafeConfig) {
      console.log(`   Using predicted Safe config...`)
      const saltNonce = predictedSafeConfig.saltNonce ?? 
        this._generateDeterministicNonce(predictedSafeConfig.owners, predictedSafeConfig.threshold)
      
      initOptions.options = {
        owners: predictedSafeConfig.owners,
        threshold: predictedSafeConfig.threshold,
        saltNonce
      }
    } else {
      throw new Error(
        'Safe is not deployed. Provide predictedSafeConfig with { owners, threshold, saltNonce? } ' +
        'or fund and deploy the Safe first.'
      )
    }

    if (this.paymasterOptions) {
      initOptions.paymasterOptions = this.paymasterOptions
    }

    console.log(`   Initializing Safe4337Pack...`)
    this.safe4337Pack = await Safe4337Pack.init(initOptions)

    if (!isDeployed) {
      const predictedBySDK = await this.safe4337Pack.protocolKit.getAddress()
      if (predictedBySDK.toLowerCase() !== safeAddress.toLowerCase()) {
        console.log(`\n   ⚠️  Address mismatch detected!`)
        console.log(`   Expected:  ${safeAddress}`)
        console.log(`   Predicted: ${predictedBySDK}`)
        this.address = predictedBySDK
      } else {
        this.address = safeAddress
      }
    } else {
      this.address = safeAddress
    }
    
    if (isDeployed) {
      this.owners = await this.safe4337Pack.protocolKit.getOwners()
      this.threshold = await this.safe4337Pack.protocolKit.getThreshold()
    } else {
      this.owners = predictedSafeConfig.owners
      this.threshold = predictedSafeConfig.threshold
    }

    console.log(`   Owners: ${this.owners.length}`)
    console.log(`   Threshold: ${this.threshold}`)
    console.log(`   Safe4337Pack initialized`)
    console.log(`   Safe: ${this.address}`)

    return {
      address: this.address,
      owners: this.owners,
      threshold: this.threshold,
      isDeployed
    }
  }

  /**
   * Propose a transaction (creates SafeOperation and uploads to Safe API)
   * @param {Object} transaction - Transaction to propose
   * @param {Object} [options] - Additional options
   * @param {bigint} [options.amountToApprove] - Override approval amount for ERC-20 paymaster
   */
  async propose(transaction, options = {}) {
    if (!this.safe4337Pack) {
      throw new Error('Safe not initialized. Call import() first.')
    }

    console.log('\n📤 Creating SafeOperation proposal...')
    console.log(`   To: ${transaction.to}`)
    console.log(`   Value: ${transaction.value || '0'}`)
    
    const createTxOptions = {
      transactions: [{
        to: transaction.to,
        value: transaction.value?.toString() || '0',
        data: transaction.data || '0x'
      }]
    }
    
    if (options.amountToApprove) {
      createTxOptions.options = {
        amountToApprove: BigInt(options.amountToApprove.toString())
      }
    }

    const safeOperation = await this.safe4337Pack.createTransaction(createTxOptions)
    console.log('   Signing SafeOperation...')
    const signedSafeOperation = await this.safe4337Pack.signSafeOperation(safeOperation)
    const safeOpHash = signedSafeOperation.getHash()
    console.log(`   SafeOp Hash: ${safeOpHash}`)

    console.log('   Uploading to Safe API...')
    await this.apiKit.addSafeOperation(signedSafeOperation)
    console.log('   ✅ Proposal uploaded to Safe API')
    console.log(`   Signatures: 1/${this.threshold}`)

    return safeOpHash
  }

  /**
   * Sign an existing proposal
   * @param {string} proposalId - SafeOperation hash
   */
  async signProposal(proposalId) {
    if (!this.safe4337Pack) {
      throw new Error('Safe not initialized. Call import() first.')
    }

    console.log(`\n✍️ Signing SafeOperation: ${proposalId.slice(0, 18)}...`)

    const safeOperationResponse = await this.apiKit.getSafeOperation(proposalId)
    if (!safeOperationResponse) {
      throw new Error(`SafeOperation not found: ${proposalId}`)
    }

    console.log(`   Found operation, confirmations: ${safeOperationResponse.confirmations?.length || 0}`)

    const signedSafeOperation = await this.safe4337Pack.signSafeOperation(safeOperationResponse)
    const signerAddress = await this.getSignerAddress()
    const signerKey = signerAddress.toLowerCase()
    
    let signature = null
    if (signedSafeOperation.signatures) {
      const sig = signedSafeOperation.signatures.get(signerKey)
      if (sig && sig.data) {
        signature = sig.data
      }
    }

    if (!signature) {
      throw new Error('Failed to get signature')
    }

    console.log(`   Signature: ${signature.slice(0, 20)}...`)
    await this.apiKit.confirmSafeOperation(proposalId, signature)
    console.log('   ✅ Confirmation uploaded')
  }

  /**
   * Execute a fully signed proposal via bundler
   * @param {string} proposalId - SafeOperation hash
   */
  async execute(proposalId) {
    if (!this.safe4337Pack) {
      throw new Error('Safe not initialized. Call import() first.')
    }

    console.log(`\n🚀 Executing SafeOperation: ${proposalId.slice(0, 18)}...`)

    const safeOperationResponse = await this.apiKit.getSafeOperation(proposalId)
    if (!safeOperationResponse) {
      throw new Error(`SafeOperation not found: ${proposalId}`)
    }

    const confirmationsCount = safeOperationResponse.confirmations?.length || 0
    console.log(`   Confirmations: ${confirmationsCount}/${this.threshold}`)

    if (confirmationsCount < this.threshold) {
      throw new Error(`Not enough signatures: ${confirmationsCount}/${this.threshold}`)
    }

    console.log('   Submitting to bundler...')
    const userOpHash = await this.safe4337Pack.executeTransaction({
      executable: safeOperationResponse
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
      console.log('   ⚠️ Receipt not yet available')
      return { success: true, txHash: null, userOpHash }
    }

    const txHash = receipt.receipt?.transactionHash || receipt.transactionHash
    console.log(`   ✅ TX Hash: ${txHash}`)

    return { success: receipt.success, txHash, userOpHash }
  }

  async isDeployed() {
    const provider = new ethers.providers.JsonRpcProvider(this.providerUrl)
    const code = await provider.getCode(this.address)
    return code !== '0x'
  }

  async getBalance(tokenAddress) {
    const provider = new ethers.providers.JsonRpcProvider(this.providerUrl)
    
    if (tokenAddress) {
      const erc20Abi = ['function balanceOf(address) view returns (uint256)']
      const contract = new ethers.Contract(tokenAddress, erc20Abi, provider)
      const balance = await contract.balanceOf(this.address)
      return BigInt(balance.toString())
    } else {
      const balance = await provider.getBalance(this.address)
      return BigInt(balance.toString())
    }
  }

  async getPendingOperations() {
    return await this.apiKit.getPendingSafeOperations(this.address)
  }

  async getOperation(safeOpHash) {
    return await this.apiKit.getSafeOperation(safeOpHash)
  }

  async isReadyToExecute(safeOpHash) {
    const operation = await this.getOperation(safeOpHash)
    if (!operation) return false
    return (operation.confirmations?.length || 0) >= this.threshold
  }

  async getSignerAddress() {
    return this._ownerAccount.getAddress()
  }

  getAddress() {
    return this.address
  }

  getOwners() {
    return this.owners
  }

  getThreshold() {
    return this.threshold
  }

  dispose() {
    this.safe4337Pack = null
    this.apiKit = null
    super.dispose()
  }
}

export default SafeMultisigEVM4337Api