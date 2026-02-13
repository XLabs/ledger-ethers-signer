## LedgerSigner

This is meant to be a basic ethers v6 signer for ledger hardware wallets.

Goals:
- Sign EVM transactions on node.js.
- Sign EVM messages on node.js.

Non-goals:
- Sign EVM transactions or messages on browsers.

Right now, signing EVM messages is untested so it may not work.

## Usage

```
import { LedgerSigner } from "@xlabs/ledger-signer-ethers-v6";
const signer = new LedgerSigner(provider, path);
// By default:
//   - path is the default Ethereum path (i.e.  `m/44'/60'/0'/0/0`)

// This signer works like an Ethers signer

// get sender address for simple transfer
const address = await signer.getAddress();
console.log(`Address: ${address}`);

const destinationAddress = address;

// create and sign transfer transaction
const tx = await signer.sendTransaction({
    to: destinationAddress,
    value: 10,
});
console.log(`Transaction ${tx.hash} sent`);

const receipt = await tx.wait();
if (receipt?.status !== 1) {
    throw new Error("Transfer failed");
}
console.log(`Transaction ${tx.hash} is successful`);
```
