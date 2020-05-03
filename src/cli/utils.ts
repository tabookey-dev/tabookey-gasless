// TODO: allow reading network URLs from 'truffle-config.js'
import commander, { CommanderStatic } from 'commander'
import fs from 'fs'

const networks = new Map<string, string>([
  ['localhost', 'http://127.0.0.1:8545'],
  ['xdai', 'https://dai.poa.network'],
  ['ropsten', 'https://ropsten.infura.io/v3/c3422181d0594697a38defe7706a1e5b'],
  ['rinkeby', 'https://rinkeby.infura.io/v3/c3422181d0594697a38defe7706a1e5b'],
  ['kovan', 'https://kovan.infura.io/v3/c3422181d0594697a38defe7706a1e5b'],
  ['mainnet', 'https://mainnet.infura.io/v3/c3422181d0594697a38defe7706a1e5b']
])

export function getNetworkUrl (network: string): string {
  const match = network.match(/^(https?:.*)?/) ?? []
  return networks.get(network) ?? match[0]
}

export function getRelayHubAddress (hub?: string): string | undefined {
  if (hub == null) {
    const relayHubDeployedPath = 'build/gsn/RelayHub.json'
    if (fs.existsSync(relayHubDeployedPath)) {
      const relayHubDeployInfo = fs.readFileSync(relayHubDeployedPath).toString()
      return JSON.parse(relayHubDeployInfo).address
    }
  }
  return hub
}

type GsnOption = 'n' | 'f' | 'h'

export function gsnCommander (options: GsnOption[]): CommanderStatic {
  options.forEach(option => {
    switch (option) {
      case 'n':
        commander.option('-n, --network <url|name>', 'network name or URL to an Ethereum node', 'localhost')
        break
      case 'f':
        commander.option('-f, --from <address>', 'account to send transactions from (default: the first account with balance)')
        break
      case 'h':
        commander.option('-h, --hub <address>', 'address of the hub contract (default: the address from build/gsn/RelayHub.json if exists)')
        break
    }
  })
  return commander
}
