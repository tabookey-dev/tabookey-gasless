/* solhint-disable avoid-tx-origin */
// SPDX-License-Identifier:MIT
pragma solidity ^0.6.2;
pragma experimental ABIEncoderV2;

import "../interfaces/IRelayHub.sol";

contract TestRelayWorkerContract {

    function relayCall(
        IRelayHub hub,
        uint maxRelayExposure,
        GsnTypes.RelayRequest memory relayRequest,
        bytes memory signature,
        uint externalGasLimit)
    public
    {
        hub.relayCall{gas:externalGasLimit}(maxRelayExposure, relayRequest, signature, "", externalGasLimit);
    }
}
