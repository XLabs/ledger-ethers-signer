## LedgerSigner

This is meant to be a basic Solana signer for ledger hardware wallets.

Goals:
- Sign Solana transactions on node.js.
- Sign Solana messages on node.js.

Non-goals:
- Sign Solana transactions or messages on browsers.

Right now, signing Solana messages is untested so it may not work.

## Usage

```
import { LedgerSigner } from "@xlabs/ledger-signer-solana";
// There is no default derivation path so you always need to specify one.
const derivationPath = `m/44'/501'/0'/0'`;
const signer = new LedgerSigner(path);

const address = await signer.getAddress();

// sign a transaction
const web3Sol = await import("@solana/web3.js");
const senderPubkey = new web3Sol.Pubkey(address);
const ix = web3Sol.SystemProgram.transfer({
    fromPubkey: senderPubkey,
    toPubkey: senderPubkey,
    lamports: 1_000_000,
});
const recentBlockhash = await connection.getLatestBlockhash();

// create and sign transfer transaction
const tx = new Transaction().add(ix);
tx.recentBlockhash = recentBlockhash.blockhash;
tx.feePayer = senderPubkey;

const signature = await signer.signTransaction(tx.compileMessage().serialize());

tx.addSignature(senderPubkey, signature);
console.log("Sig verifies:", tx.verifySignatures());

const result = await connection.sendRawTransaction(tx.serialize());
console.log(`Transaction ${result} sent`);
```
