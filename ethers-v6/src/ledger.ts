// Partially inspired by https://github.com/ethers-io/ext-signer-ledger
import {
    AbstractSigner,
    copyRequest,
    getAddress,
    hexlify,
    resolveAddress,
    resolveProperties,
    Signature,
    Transaction,
    toUtf8Bytes,
    TypedDataEncoder,
    Provider,
    TypedDataDomain,
    TypedDataField,
    TransactionRequest,
    TransactionLike,
} from "ethers";
import Eth from "@ledgerhq/hw-app-eth";
import Transport from "@ledgerhq/hw-transport-node-hid";

const defaultPath = "m/44'/60'/0'/0/0";

function sleep(duration: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, duration);
    });
}

let createEthApp = false;
let ethApp: Eth;

/**
 *  A **LedgerSigner** provides access to a Ledger Hardware Wallet
 *  as an Ethers Signer.
 */
export class LedgerSigner extends AbstractSigner {
    // This configuration is used to resolve properties when trying to clear sign.
    // TODO: figure out what and how these are resolved exactly.
    private readonly resolutionConfig = {
        domain: true,
        nft: true,
        erc20: true,
        plugin: true,
        externalPlugins: true,
    };

    /**
     *  Create a new **LedgerSigner** connected to the device over the
     *  %%transport%% and optionally connected to the blockchain via
     *  %%provider%%. The %%path%% follows the same logic as
     *  [[LedgerSigner_getPath]], defaulting to the default HD path of
     *  ``m/44'/60'/0'/0/0``.
     */
    private constructor(
        provider: Provider | null,
        private readonly ethApp: Eth,
        public readonly path: string,
    ) {
        super(provider);
    }

    connect(provider: Provider | null = null): LedgerSigner {
        return new LedgerSigner(provider, ethApp, this.path);
    }

    public static async create(provider: Provider | null, path = defaultPath) {
        if (!createEthApp) {
            createEthApp = true;
            const transport = await Transport.open(undefined);
            ethApp = new Eth(transport);
            // Check that the connection is working
            await ethApp.getAppConfiguration();
        } else if (ethApp === undefined) {
            // The transport is in the process of being created
            for (let i = 0; i < 1200; i++) {
                await sleep(100);
                if (ethApp !== undefined) break;
                if (i === 1199) {
                    throw new Error(
                        "Timed out while waiting for transport to open.",
                    );
                }
            }
        }

        return new LedgerSigner(provider, ethApp, path);
    }

    /**
     *  Returns a new LedgerSigner connected via the same transport
     *  and provider, but using the account at the HD %%path%%.
     */
    // getSigner(path?: string | number): LedgerSigner {
    //     return new LedgerSigner(this.#transport, this.provider, path);
    // }

    private async _retry<T = any>(
        operation: (eth: Eth) => Promise<T>,
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
                    throw error;
                }
            }
            await sleep(100);
        }

        throw new Error("timeout");
    }

    public async getAddress(): Promise<string> {
        try {
            const account = await this._retry((eth) =>
                eth.getAddress(this.path),
            );
            return getAddress(account.address);
        } catch (error) {
            // TODO: check if this error type is exported in some ledger library.
            if ((error as any)?.statusCode === 27404) {
                // TODO: define a custom error type for this?
                throw new Error(`Ledger device is not running Ethereum App`);
            }

            throw error;
        }
    }

    async signTransaction(txRequest: TransactionRequest): Promise<string> {
        // Replace any Addressable or ENS name with an address
        txRequest = copyRequest(txRequest);
        const { to, from } = await resolveProperties({
            to: txRequest.to
                ? resolveAddress(txRequest.to, this.provider)
                : undefined,
            from: txRequest.from
                ? resolveAddress(txRequest.from, this.provider)
                : undefined,
        });

        if (to != null) {
            txRequest.to = to;
        }
        if (from != null) {
            txRequest.from = from;
        }

        const tx = Transaction.from(<TransactionLike<string>>txRequest);
        const rawTx = tx.unsignedSerialized.substring(2);

        // Ask the Ledger to sign for us
        const sig = await this._retry((eth) =>
            eth.clearSignTransaction(this.path, rawTx, this.resolutionConfig),
        );

        // Normalize the signature for Ethers
        sig.v = "0x" + sig.v;
        sig.r = "0x" + sig.r;
        sig.s = "0x" + sig.s;

        // Update the transaction with the signature
        tx.signature = sig;

        return tx.serialized;
    }

    async signMessage(message: string | Uint8Array): Promise<string> {
        if (typeof message === "string") {
            message = toUtf8Bytes(message);
        }

        const messageHex = hexlify(message).substring(2);
        const sig = await this._retry((eth) =>
            eth.signPersonalMessage(this.path, messageHex),
        );

        // Normalize the signature for Ethers
        sig.r = "0x" + sig.r;
        sig.s = "0x" + sig.s;

        // Serialize the signature
        return Signature.from(sig).serialized;
    }

    async signTypedData(
        domain: TypedDataDomain,
        types: Record<string, Array<TypedDataField>>,
        value: Record<string, any>,
    ): Promise<string> {
        // Populate any ENS names
        const populated = await TypedDataEncoder.resolveNames(
            domain,
            types,
            value,
            (name: string) => {
                return resolveAddress(name, this.provider) as Promise<string>;
            },
        );

        const payload = TypedDataEncoder.getPayload(
            populated.domain,
            types,
            populated.value,
        );

        let sig: { r: string; s: string; v: number };
        try {
            // Try signing the EIP-712 message
            sig = await this._retry((eth) =>
                eth.signEIP712Message(this.path, payload),
            );
        } catch (error) {
            // TODO: what error code is this? try to import it from library
            if ((error as any)?.statusCode !== 27904) throw error;

            // Older device; fallback onto signing raw hashes
            const domainHash = TypedDataEncoder.hashDomain(domain);
            const valueHash = TypedDataEncoder.from(types).hash(value);
            sig = await this._retry((eth) =>
                eth.signEIP712HashedMessage(
                    this.path,
                    domainHash.substring(2),
                    valueHash.substring(2),
                ),
            );
        }

        // Normalize the signature for Ethers
        sig.r = "0x" + sig.r;
        sig.s = "0x" + sig.s;

        // Serialize the signature
        return Signature.from(sig).serialized;
    }
}
