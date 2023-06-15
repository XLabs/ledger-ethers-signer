import { ethers } from "ethers";
import Eth from "@ledgerhq/hw-app-eth";
import Transport from "@ledgerhq/hw-transport-node-hid";

const defaultPath = "m/44'/60'/0'/0/0";

function sleep(duration: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, duration);
    });
}

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
        public readonly path: string
    ) {
        super();
    }

    public static async create(
        provider: ethers.providers.Provider,
        path = defaultPath
    ) {
        const transport = await Transport.create();
        const eth = new Eth(transport);
        // Check that the connection is working
        await eth.getAppConfiguration();

        return new LedgerSigner(provider, eth, path);
    }

    private async _retry<T = any>(
        operation: (eth: Eth) => Promise<T>
    ): Promise<T> {
        // Wait up to 120 seconds
        for (let i = 0; i < 1200; i++) {
            try {
                const result = await operation(this.ethApp);
                return result;
            } catch (error: any) {
                // `TransportLocked` indicates that a request is being processed.
                // It allows defining a critical section in the driver.
                // We only need to retry the request until the driver isn't busy servicing another request.
                if (error?.id !== "TransportLocked") {
                    // TODO: remove this assignment once https://github.com/LedgerHQ/ledger-live/pull/3631 is included in a release.
                    error.stack = `${error.message}\n${error.stack}`;
                    throw error;
                }
            }
            await sleep(100);
        }

        throw new Error("timeout");
    }

    public async getAddress(): Promise<string> {
        const account = await this._retry((eth) => eth.getAddress(this.path));
        return ethers.utils.getAddress(account.address);
    }

    public async signMessage(
        message: ethers.utils.Bytes | string
    ): Promise<string> {
        if (typeof message === "string") {
            message = ethers.utils.toUtf8Bytes(message);
        }

        const messageHex = ethers.utils.hexlify(message).substring(2);

        const sig = await this._retry((eth) =>
            eth.signPersonalMessage(this.path, messageHex)
        );
        sig.r = `0x${sig.r}`;
        sig.s = `0x${sig.s}`;
        return ethers.utils.joinSignature(sig);
    }

    public async signTransaction(
        transaction: ethers.providers.TransactionRequest
    ): Promise<string> {
        const tx = await ethers.utils.resolveProperties(transaction);
        // We create a separate object because the `nonce` field should be a number
        const baseTx: ethers.utils.UnsignedTransaction = {
            chainId: tx.chainId,
            data: tx.data,
            gasLimit: tx.gasLimit,
            nonce: tx.nonce
                ? ethers.BigNumber.from(tx.nonce).toNumber()
                : undefined,
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

        const unsignedTx = ethers.utils
            .serializeTransaction(baseTx)
            .substring(2);
        const sig = await this._retry((eth) =>
            eth.clearSignTransaction(
                this.path,
                unsignedTx,
                this.resolutionConfig
            )
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
