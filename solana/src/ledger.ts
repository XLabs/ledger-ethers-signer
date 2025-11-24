import SolanaApp from "@ledgerhq/hw-app-solana";
import Transport from "@ledgerhq/hw-transport-node-hid";

function sleep(duration: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, duration);
    });
}

let createSolApp = false;
let solApp: SolanaApp;
// This cache is only valid for a single device.
// Since we only ever open a connection once and we don't attempt to reconnect,
// we don't need to handle cache invalidation.
const addressCache: Record<string, Buffer | undefined> = {};

export class SolanaLedgerSigner {

    private constructor(
        private readonly solApp: SolanaApp,
        public readonly path: string
    ) {}

    /**
     * @param path Must be a string describing the derivation path that follows this format roughly:
     * `44'/501'/0'/0'`. Note that there is no `m` to mark the root node.
     */
    public static async create(
        path: string
    ) {
        if (!createSolApp) {
            createSolApp = true;
            const transport = await Transport.open(undefined);
            solApp = new SolanaApp(transport);
            // Check that the connection is working
            await solApp.getAppConfiguration();
        } else if (solApp === undefined) {
            // The transport is in the process of being created
            for (let i = 0; i < 1200; i++) {
                await sleep(100);
                if (solApp !== undefined) break;
                if (i === 1199) {
                    throw new Error(
                        "Timed out while waiting for transport to open."
                    );
                }
            }
        }

        return new SolanaLedgerSigner(solApp, path);
    }

    private async _retry<T = any>(
        operation: (eth: SolanaApp) => Promise<T>
    ): Promise<T> {
        // Wait up to 120 seconds
        for (let i = 0; i < 1200; i++) {
            try {
                const result = await operation(this.solApp);
                return result;
            } catch (error: any) {
                // `TransportLocked` indicates that a request is being processed.
                // It allows defining a critical section in the driver.
                // We only need to retry the request until the driver isn't busy servicing another request.
                if (error?.id !== "TransportLocked") {
                    throw error;
                }
            }
            await sleep(100);
        }

        throw new Error("timeout");
    }

    public async getAddress(): Promise<Buffer> {
        const cachedAddress = addressCache[this.path];
        if (cachedAddress !== undefined) return Buffer.copyBytesFrom(cachedAddress);

        const {address} = await this._retry((sol) => sol.getAddress(this.path));
        addressCache[this.path] = address;
        return Buffer.copyBytesFrom(address);
    }

    public async signMessage(
        message: Buffer
    ): Promise<Buffer> {
        const {signature} = await this._retry((sol) => sol.signOffchainMessage(this.path, message));
        return signature;
    }

    public async signTransaction(
        transaction: Buffer
    ): Promise<Buffer> {
        const {signature} = await this._retry((sol) => sol.signTransaction(this.path, transaction));
        return signature;
    }
}
