require('ts-node/register/transpile-only')

module.exports = {
  // CLI package needs to deploy contracts from JSON artifacts
  contracts_build_directory: '../cli/src/compiled',
  // valid only from the "flatten" script
  contracts_directory: './build/flatten',
  compilers: {
    solc: {
      version: '0.7.6',
      settings: {
        evmVersion: 'istanbul',
        optimizer: {
          enabled: true,
          runs: 200
        }
      }
    }
  }
}
