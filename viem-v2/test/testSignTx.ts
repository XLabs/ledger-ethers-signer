import { LedgerAccount } from "../src/ledger";
import {
  createPublicClient,
  createWalletClient,
  http,
} from 'viem';
import { sepolia } from 'viem/chains';

async function main() {
    const rpcUrl = "https://ethereum-sepolia-rpc.publicnode.com";

    const client = createPublicClient({
        chain: sepolia,
        transport: http(rpcUrl),
    });
    const account = await LedgerAccount.create();

    const walletClient = createWalletClient({
        account,
        chain: sepolia,
        transport: http(rpcUrl),
    });

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
}

main();
