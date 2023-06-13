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

## Known issues

When signing transactions with the ledger device, errors thrown don't have the error message in the `stack` property. This is [fixed upstream](https://github.com/LedgerHQ/ledger-live/pull/3631) but it may take sometime until it's released and incorporated into this package.

In the meantime, we recommend printing out errors like this:
```js
  try {
    // some transaction sign operation
  } catch (error) {
    const errorMessage = `${error.message}\n${error.stack}`;
    error.message = errorMessage;
    throw error;
  }
```

This will result in duplicate error messages for normal errors but will let you see ledger device errors.
