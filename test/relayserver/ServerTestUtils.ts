// @ts-ignore
import abiDecoder from 'abi-decoder'
import crypto from 'crypto'
import Web3 from 'web3'
import { TransactionReceipt } from 'web3-core'
import { PrefixedHexString } from 'ethereumjs-tx'
import { toBN, toHex } from 'web3-utils'
import * as ethUtils from 'ethereumjs-util'

import ContractInteractor from '../../src/relayclient/ContractInteractor'
import GsnTransactionDetails from '../../src/relayclient/types/GsnTransactionDetails'
import PayMasterABI from '../../src/common/interfaces/IPaymaster.json'
import PingResponse from '../../src/common/PingResponse'
import RelayHubABI from '../../src/common/interfaces/IRelayHub.json'
import { RelayMetadata, RelayTransactionRequest } from '../../src/relayclient/types/RelayTransactionRequest'
import StakeManagerABI from '../../src/common/interfaces/IStakeManager.json'
import { Address } from '../../src/relayclient/types/Aliases'
import { IStakeManagerInstance } from '../../types/truffle-contracts'
import { KeyManager } from '../../src/relayserver/KeyManager'
import { RelayClient } from '../../src/relayclient/RelayClient'
import { RelayInfo } from '../../src/relayclient/types/RelayInfo'
import { RelayRegisteredEventInfo } from '../../src/relayclient/types/RelayRegisteredEventInfo'
import { RelayServer } from '../../src/relayserver/RelayServer'
import { TxStoreManager } from '../../src/relayserver/TxStoreManager'
import { configureGSN, GSNConfig } from '../../src/relayclient/GSNConfigurator'
import { constants } from '../../src/common/Constants'
import { removeHexPrefix } from '../../src/common/Utils'
import { ServerConfigParams, ServerDependencies } from '../../src/relayserver/ServerConfigParams'

const { oneEther, weekInSec } = constants

const TestRecipient = artifacts.require('TestRecipient')
const TestPaymasterEverythingAccepted = artifacts.require('TestPaymasterEverythingAccepted')

abiDecoder.addABI(RelayHubABI)
abiDecoder.addABI(StakeManagerABI)
abiDecoder.addABI(PayMasterABI)
// @ts-ignore
abiDecoder.addABI(TestRecipient.abi)
// @ts-ignore
abiDecoder.addABI(TestPaymasterEverythingAccepted.abi)

export interface NewRelayParams {
  ethereumNodeUrl?: string
  relayHubAddress: Address
  relayOwner: Address
  url: string
  web3: Web3
  stakeManager: IStakeManagerInstance
}

export async function bringUpNewRelay (
  newRelayParams: NewRelayParams,
  partialConfig: Partial<GSNConfig> = {},
  partialDependencies: Partial<ServerDependencies> = {},
  overrideParams: Partial<ServerConfigParams> = {}
): Promise<RelayServer> {
  const managerKeyManager = partialDependencies.managerKeyManager ?? new KeyManager(1, undefined, crypto.randomBytes(32).toString())
  const workersKeyManager = partialDependencies.workersKeyManager ?? new KeyManager(1, undefined, crypto.randomBytes(32).toString())
  assert.equal(await web3.eth.getBalance(managerKeyManager.getAddress(0)), '0')
  assert.equal(await web3.eth.getBalance(workersKeyManager.getAddress(0)), '0')
  const txStoreManager = partialDependencies.txStoreManager ?? new TxStoreManager({ workdir: getTemporaryWorkdirs().workdir })
  let contractInteractor = partialDependencies.contractInteractor
  if (contractInteractor == null) {
    if (newRelayParams.ethereumNodeUrl == null) {
      throw new Error('Must provide either node URL or contract interactor')
    }
    const serverWeb3provider = new Web3.providers.HttpProvider(newRelayParams.ethereumNodeUrl)
    contractInteractor = new ContractInteractor(serverWeb3provider, configureGSN(partialConfig))
    await contractInteractor.init()
  }
  const serverDependencies = {
    txStoreManager,
    managerKeyManager,
    workersKeyManager,
    contractInteractor
  }
  const params: Partial<ServerConfigParams> = {
    relayHubAddress: newRelayParams.relayHubAddress,
    url: newRelayParams.url,
    baseRelayFee: '0',
    pctRelayFee: 0,
    gasPriceFactor: 1,
    devMode: true,
    ...overrideParams
  }
  const newServer = new RelayServer(params, serverDependencies)
  newServer.on('error', (e) => {
    console.log('newServer event', e.message)
  })
  const relayOwner = newRelayParams.relayOwner
  await web3.eth.sendTransaction({
    to: newServer.managerAddress,
    from: relayOwner,
    value: web3.utils.toWei('2', 'ether')
  })

  const stakeForAddressReceipt = await newRelayParams.stakeManager.stakeForAddress(newServer.managerAddress, weekInSec, {
    from: relayOwner,
    value: oneEther
  })
  assert.equal(stakeForAddressReceipt.logs[0].event, 'StakeAdded')
  const authorizeHubReceipt = await newRelayParams.stakeManager.authorizeHubByOwner(newServer.managerAddress, newRelayParams.relayHubAddress, {
    from: relayOwner
  })
  assert.equal(authorizeHubReceipt.logs[0].event, 'HubAuthorized')
  await newServer.init()
  return newServer
}

export function assertRelayAdded (receipts: TransactionReceipt[], server: RelayServer, checkWorkers = true): void {
  const registeredReceipt = receipts.find(r => {
    const decodedLogs = abiDecoder.decodeLogs(r.logs).map(server.registrationManager._parseEvent)
    return decodedLogs[0].name === 'RelayServerRegistered'
  })
  if (registeredReceipt == null) {
    throw new Error('Registered Receipt not found')
  }
  const registeredLogs = abiDecoder.decodeLogs(registeredReceipt.logs).map(server.registrationManager._parseEvent)
  assert.equal(registeredLogs.length, 1)
  assert.equal(registeredLogs[0].name, 'RelayServerRegistered')
  assert.equal(registeredLogs[0].args.relayManager.toLowerCase(), server.managerAddress.toLowerCase())
  assert.equal(registeredLogs[0].args.baseRelayFee, server.config.baseRelayFee)
  assert.equal(registeredLogs[0].args.pctRelayFee, server.config.pctRelayFee)
  assert.equal(registeredLogs[0].args.relayUrl, server.config.url)

  if (checkWorkers) {
    const workersAddedReceipt = receipts.find(r => {
      const decodedLogs = abiDecoder.decodeLogs(r.logs).map(server.registrationManager._parseEvent)
      return decodedLogs[0].name === 'RelayWorkersAdded'
    })
    const workersAddedLogs = abiDecoder.decodeLogs(workersAddedReceipt!.logs).map(server.registrationManager._parseEvent)
    assert.equal(workersAddedLogs.length, 1)
    assert.equal(workersAddedLogs[0].name, 'RelayWorkersAdded')
  }
}

export async function assertTransactionRelayed (
  server: RelayServer,
  txHash: PrefixedHexString,
  gasLess: Address,
  recipientAddress: Address,
  paymasterAddress: Address,
  web3: Web3): Promise<TransactionReceipt> {
  const receipt = await web3.eth.getTransactionReceipt(txHash)
  if (receipt == null) {
    throw new Error('Transaction Receipt not found')
  }
  const decodedLogs = abiDecoder.decodeLogs(receipt.logs).map(server.registrationManager._parseEvent)
  const event1 = decodedLogs.find((e: { name: string }) => e.name === 'SampleRecipientEmitted')
  assert.exists(event1, 'SampleRecipientEmitted not found, maybe transaction was not relayed successfully')
  assert.equal(event1.args.message, 'hello world')
  const event2 = decodedLogs.find((e: { name: string }) => e.name === 'TransactionRelayed')
  assert.exists(event2, 'TransactionRelayed not found, maybe transaction was not relayed successfully')
  assert.equal(event2.name, 'TransactionRelayed')
  assert.equal(event2.args.relayWorker.toLowerCase(), server.workerAddress.toLowerCase())
  assert.equal(event2.args.from.toLowerCase(), gasLess.toLowerCase())
  assert.equal(event2.args.to.toLowerCase(), recipientAddress.toLowerCase())
  assert.equal(event2.args.paymaster.toLowerCase(), paymasterAddress.toLowerCase())
  return receipt
}

export interface RelayTransactionParams {
  gasLess: Address
  recipientAddress: Address
  relayHubAddress: Address
  encodedFunction: PrefixedHexString
  paymasterData: PrefixedHexString
  clientId: string
  forwarderAddress: Address
  paymasterAddress: Address
  web3: Web3
  relayServer: RelayServer
  relayClient: RelayClient
}

export async function relayTransaction (
  relayTransactionParams: RelayTransactionParams,
  options: PrepareRelayRequestOption,
  assertRelayed = true): Promise<PrefixedHexString> {
  const request = await prepareRelayRequest(relayTransactionParams, options)
  return await relayTransactionFromRequest(relayTransactionParams, request, assertRelayed)
}

export interface PrepareRelayRequestOption {
  to: string
  from: string
  paymaster: string
  pctRelayFee: number
  baseRelayFee: string
}

export async function prepareRelayRequest (
  params: RelayTransactionParams,
  options: PrepareRelayRequestOption
): Promise<RelayTransactionRequest> {
  const pingResponse = {
    // Ready,
    // MinGasPrice: await _web3.eth.getGasPrice(),
    RelayHubAddress: params.relayHubAddress,
    RelayServerAddress: params.relayServer.workerAddress
    // RelayManagerAddress,
    // Version
  }
  const eventInfo: RelayRegisteredEventInfo = {
    baseRelayFee: options.baseRelayFee.toString(),
    pctRelayFee: options.pctRelayFee.toString(),
    relayManager: '',
    relayUrl: ''
  }
  const relayInfo: RelayInfo = {
    pingResponse: pingResponse as PingResponse,
    relayInfo: eventInfo
  }
  const gsnTransactionDetails: GsnTransactionDetails = {
    paymaster: options.paymaster,
    paymasterData: params.paymasterData,
    clientId: params.clientId,
    data: params.encodedFunction,
    forwarder: params.forwarderAddress,
    from: options.from,
    gas: toHex(1e6),
    gasPrice: toHex(await web3.eth.getGasPrice()),
    to: options.to
  }
  return await params.relayClient._prepareRelayHttpRequest(relayInfo,
    gsnTransactionDetails)
}

// TODO: this is the worst piece of code in the history of code
export async function relayTransactionFromRequest (
  params: RelayTransactionParams,
  fromRequestParam: RelayTransactionRequest,
  assertRelayed: boolean = true): Promise<PrefixedHexString> {
  const metadata: RelayMetadata = {
    approvalData: fromRequestParam.metadata.approvalData,
    relayMaxNonce: fromRequestParam.metadata.relayMaxNonce,
    relayHubAddress: params.relayHubAddress,
    signature: fromRequestParam.metadata.signature
  }
  const signedTx = await params.relayServer.createRelayTransaction(
    {
      relayRequest: fromRequestParam.relayRequest,
      metadata
    })
  const txhash = ethUtils.bufferToHex(ethUtils.keccak256(Buffer.from(removeHexPrefix(signedTx), 'hex')))
  if (assertRelayed) {
    await assertTransactionRelayed(params.relayServer, txhash, fromRequestParam.relayRequest.request.from, params.recipientAddress, params.paymasterAddress, params.web3)
  }
  return signedTx
}

export function getTotalTxCosts (receipts: TransactionReceipt[], gasPrice: string): ethUtils.BN {
  return receipts.map(r => toBN(r.gasUsed).mul(toBN(gasPrice))).reduce(
    (previous, current) => previous.add(current), toBN(0))
}

export async function clearStorage (txStoreManager: TxStoreManager): Promise<void> {
  await txStoreManager.clearAll()
  assert.deepEqual([], await txStoreManager.getAll())
}

export interface ServerWorkdirs {
  workdir: string
  managerWorkdir: string
  workersWorkdir: string
}

export function getTemporaryWorkdirs (): ServerWorkdirs {
  const workdir = '/tmp/gsn/test/relayserver/defunct' + Date.now().toString()
  const managerWorkdir = workdir + '/manager'
  const workersWorkdir = workdir + '/workers'

  return {
    workdir,
    managerWorkdir,
    workersWorkdir
  }
}
