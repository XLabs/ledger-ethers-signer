## LedgerSigner

This is meant to be a basic ethers signer for ledger hardware wallets.

Goals:
- Sign EVM transactions on node.js.
- Sign EVM messages on node.js.
Non-goals:
- Sign EVM transactions or messages on browsers.

Right now, signing EVM messages is untested so it may not work.

## Usage

```
import { LedgerSigner } from "@xlabs/ledger-signer";
const signer = new LedgerSigner(provider, path);
// By default:
//   - path is the default Ethereum path (i.e.  `m/44'/60'/0'/0/0`)
```
