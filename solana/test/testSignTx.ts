import { SolanaLedgerSigner } from "../src/ledger";
import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

async function main() {
    const connection = new Connection("https://api.devnet.solana.com", "confirmed");
    const derivationPath = "44'/501'/0'/0'";
    const signer = await SolanaLedgerSigner.create(derivationPath);

    // get sender pubkey for transfer instruction
    const address = await signer.getAddress();
    const senderPubkey = new PublicKey(address);
    console.log(`Address: ${senderPubkey.toBase58()}`);

    // create SOL transfer instruction
    const to_pubkey = new PublicKey("7erdYqdCRC6KaWebtCbg14nPecN8Yib7xyfayXQhQ1dQ");
    const ix = SystemProgram.transfer({
        fromPubkey: senderPubkey,
        toPubkey: to_pubkey,
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
}

main();
