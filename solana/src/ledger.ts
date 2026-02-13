import SolanaApp from "@ledgerhq/hw-app-solana";
import Transport from "@ledgerhq/hw-transport-node-hid";
import { retry, sleep, parseBip32Path } from "@xlabs-xyz/ledger-signer-common";

let createSolApp = false;
// This cache is only valid for a single device.
// Since we only ever open a connection once and we don't attempt to reconnect,
// we don't need to handle cache invalidation.
const addressCache: Record<string, Buffer | undefined> = {};

export class SolanaLedgerSigner {
    private constructor(
        public readonly path: string,
    ) {}

    public static app: SolanaApp;

    /**
     * @param path Must be a string describing the derivation path that follows this format roughly:
     * `44'/501'/0'/0'`. Note that there is no `m` to mark the root node.
     */
    public static async create(path: string) {
        path = parseBip32Path(path).normalized;

        if (!createSolApp) {
            createSolApp = true;
            const transport = await Transport.open(undefined);
            this.app = new SolanaApp(transport);
            // Check that the connection is working
            await this.app.getAppConfiguration();
        } else if (this.app === undefined) {
            // The transport is in the process of being created
            for (let i = 0; i < 1200; i++) {
                await sleep(100);
                if (this.app !== undefined) break;
                if (i === 1199) {
                    throw new Error("Timed out while waiting for transport to open.");
                }
            }
        }

        return new SolanaLedgerSigner(path);
    }

    private static readonly retry = retry(this);

    public async getAddress(): Promise<Buffer> {
        const cachedAddress = addressCache[this.path];
        if (cachedAddress !== undefined) return Buffer.copyBytesFrom(cachedAddress);

        const { address } = await SolanaLedgerSigner.retry((sol) => sol.getAddress(this.path));
        addressCache[this.path] = address;
        return Buffer.copyBytesFrom(address);
    }

    public async signMessage(message: Buffer): Promise<Buffer> {
        const { signature } = await SolanaLedgerSigner.retry((sol) => sol.signOffchainMessage(this.path, message));
        return signature;
    }

    public async signTransaction(transaction: Buffer): Promise<Buffer> {
        const { signature } = await SolanaLedgerSigner.retry((sol) => sol.signTransaction(this.path, transaction));
        return signature;
    }
}
