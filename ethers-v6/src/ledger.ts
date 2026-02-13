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
import { retry, sleep, parseBip32Path } from "@xlabs-xyz/ledger-signer-common";

const defaultPath = "m/44'/60'/0'/0/0";

let createEthApp = false;
// This cache is only valid for a single device.
// Since we only ever open a connection once and we don't attempt to reconnect,
// we don't need to handle cache invalidation.
const addressCache: Record<string, string | undefined> = {};

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
        return new LedgerSigner(provider, this.ethApp, this.path);
    }

    public static app: Eth;

    public static async create(provider: Provider | null, path = defaultPath) {
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
        const address = (addressCache[this.path] = getAddress(account.address));
        return address;
    }

    async signTransaction(txRequest: TransactionRequest): Promise<string> {
        // Replace any Addressable or ENS name with an address
        txRequest = copyRequest(txRequest);
        const { to, from } = await resolveProperties({
            to: txRequest.to ? resolveAddress(txRequest.to, this.provider) : undefined,
            from: txRequest.from ? resolveAddress(txRequest.from, this.provider) : undefined,
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
        const sig = await LedgerSigner.retry((eth) => eth.clearSignTransaction(this.path, rawTx, this.resolutionConfig));

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
        const sig = await LedgerSigner.retry((eth) => eth.signPersonalMessage(this.path, messageHex));

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
        const populated = await TypedDataEncoder.resolveNames(domain, types, value, (name: string) => {
            return resolveAddress(name, this.provider) as Promise<string>;
        });

        const payload = TypedDataEncoder.getPayload(populated.domain, types, populated.value);

        let sig: { r: string; s: string; v: number };
        try {
            // Try signing the EIP-712 message
            sig = await LedgerSigner.retry((eth) => eth.signEIP712Message(this.path, payload));
        } catch (error) {
            // TODO: what error code is this? try to import it from library
            if ((error as any)?.statusCode !== 27904) throw error;

            // Older device; fallback onto signing raw hashes
            const domainHash = TypedDataEncoder.hashDomain(domain);
            const valueHash = TypedDataEncoder.from(types).hash(value);
            sig = await LedgerSigner.retry((eth) =>
                eth.signEIP712HashedMessage(this.path, domainHash.substring(2), valueHash.substring(2)),
            );
        }

        // Normalize the signature for Ethers
        sig.r = "0x" + sig.r;
        sig.s = "0x" + sig.s;

        // Serialize the signature
        return Signature.from(sig).serialized;
    }
}
