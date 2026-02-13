import { ethers } from "ethers";
import Eth from "@ledgerhq/hw-app-eth";
import Transport from "@ledgerhq/hw-transport-node-hid";
import { retry, sleep, parseBip32Path } from "@xlabs-xyz/ledger-signer-common";

const defaultPath = "m/44'/60'/0'/0/0";

let createEthApp = false;
// This cache is only valid for a single device.
// Since we only ever open a connection once and we don't attempt to reconnect,
// we don't need to handle cache invalidation.
const addressCache: Record<string, string | undefined> = {};

export class LedgerSigner extends ethers.Signer {
    // This configuration is used to resolve properties when trying to clear sign.
    // TODO: figure out what and how these are resolved exactly.
    private readonly resolutionConfig = {
        nft: true,
        erc20: true,
        externalPlugins: true,
    };

    private constructor(
        public readonly provider: ethers.providers.Provider,
        private readonly ethApp: Eth,
        public readonly path: string,
    ) {
        super();
    }


    public static app: Eth;

    public static async create(provider: ethers.providers.Provider, path = defaultPath) {
        path = parseBip32Path(path).normalized;

        if (!createEthApp) {
            createEthApp = true;
            const transport = await Transport.open(undefined);
            this.app = new Eth(transport);
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

        return new LedgerSigner(provider, this.app, path);
    }

    private static readonly retry = retry(this, (error) => {
        // TODO: check if this error type is exported in some ledger library.
        if (error?.statusCode === 27404) {
            // TODO: define a custom error type for this?
            throw new Error(`Ledger device is not running Ethereum App`);
        }
    });

    public async getAddress(): Promise<string> {
        const cachedAddress = addressCache[this.path];
        if (cachedAddress !== undefined) return cachedAddress;

        const account = await LedgerSigner.retry((eth) => eth.getAddress(this.path));
        const address = (addressCache[this.path] = ethers.utils.getAddress(account.address));
        return address;
    }

    public async signMessage(message: ethers.utils.Bytes | string): Promise<string> {
        if (typeof message === "string") {
            message = ethers.utils.toUtf8Bytes(message);
        }

        const messageHex = ethers.utils.hexlify(message).substring(2);

        const sig = await LedgerSigner.retry((eth) => eth.signPersonalMessage(this.path, messageHex));
        sig.r = `0x${sig.r}`;
        sig.s = `0x${sig.s}`;
        return ethers.utils.joinSignature(sig);
    }

    public async signTransaction(transaction: ethers.providers.TransactionRequest): Promise<string> {
        const tx = await ethers.utils.resolveProperties(transaction);
        // We create a separate object because the `nonce` field should be a number
        const baseTx: ethers.utils.UnsignedTransaction = {
            chainId: tx.chainId,
            data: tx.data,
            gasLimit: tx.gasLimit,
            nonce: tx.nonce ? ethers.BigNumber.from(tx.nonce).toNumber() : undefined,
            to: tx.to,
            value: tx.value,
            type: tx.type,
            ...(tx.type === 0 && { gasPrice: tx.gasPrice }),
            ...(tx.type === 1 && { accessList: tx.accessList }),
            ...(tx.type === 2 && {
                maxFeePerGas: tx.maxFeePerGas,
                maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
                accessList: tx.accessList,
            }),
        };

        const unsignedTx = ethers.utils.serializeTransaction(baseTx).substring(2);
        const sig = await LedgerSigner.retry(
            (eth) => eth.clearSignTransaction(this.path, unsignedTx, this.resolutionConfig)
        );

        return ethers.utils.serializeTransaction(baseTx, {
            v: ethers.BigNumber.from(`0x${sig.v}`).toNumber(),
            r: `0x${sig.r}`,
            s: `0x${sig.s}`,
        });
    }

    public connect(provider: ethers.providers.Provider): ethers.Signer {
        return new LedgerSigner(provider, this.ethApp, this.path);
    }
}
