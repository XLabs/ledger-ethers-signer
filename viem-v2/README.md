## LedgerAccount

This is meant to be a basic viem v2 signer for ledger hardware wallets.

Goals:
- Sign EVM transactions on node.js.
- Sign EVM messages on node.js.

Non-goals:
- Sign EVM transactions or messages on browsers.

Right now, signing EVM messages is untested so it may not work.

## Usage

```
import { LedgerAccount } from "@xlabs/ledger-signer-viem-v2";
const account = new LedgerAccount(path);
// By default:
//   - path is the default Ethereum path (i.e.  `m/44'/60'/0'/0/0`)

// This class works like a viem Account

const client = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
});

// get sender address for simple transfer
console.log(`Address: ${account.address}`);

// create and sign transfer transaction
const hash = await walletClient.sendTransaction({
    to: account.address,
    value: 10n,
});
console.log(`Transaction ${hash} sent`);

const receipt = await client.waitForTransactionReceipt({ hash });
if (receipt.status === "reverted") {
    throw new Error("Transfer failed");
}
console.log(`Transaction ${hash} is successful`);
```
