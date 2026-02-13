import {
    Address,
    getAddress,
    LocalAccount,
    TransactionSerializable,
    SerializeTransactionFn,
    Hex,
    TransactionSerialized,
    GetTransactionType,
    serializeTransaction,
    isHex,
    SignableMessage,
    SignMessageReturnType,
    toHex,
    serializeSignature,
    SignTypedDataReturnType,
    TypedData,
    TypedDataDefinition,
    hashDomain,
    hashTypedData
} from "viem";
import Eth from "@ledgerhq/hw-app-eth";
import Transport from "@ledgerhq/hw-transport-node-hid";
import { Bip32Path, Bip44PathIndices, sleep, parseBip32Path, retry } from "@xlabs-xyz/ledger-signer-common";

const defaultPath = "m/44'/60'/0'/0/0";

let createEthApp = false;

interface CacheAccount {
    address: Address;
    publicKey: Hex;
}

// This cache is only valid for a single device.
// Since we only ever open a connection once and we don't attempt to reconnect,
// we don't need to handle cache invalidation.
const accountCache: Record<string, CacheAccount | undefined> = {};

interface HDOptions {
    /** The account index to use in the path (`"m/44'/60'/${accountIndex}'/0/0"`).
     *  If the 32nd bit is set, the node is hardened. */
    accountIndex?: number;
    /** The address index to use in the path (`"m/44'/60'/0'/0/${addressIndex}"`).
     *  If the 32nd bit is set, the node is hardened. */
    addressIndex?: number;
    /** The change index to use in the path (`"m/44'/60'/0'/${changeIndex}/0"`).
     *  If the 32nd bit is set, the node is hardened. */
    changeIndex?: number;
    path: string;
}

type SignTransactionReturnType<
  serializer extends
    SerializeTransactionFn<TransactionSerializable> = SerializeTransactionFn<TransactionSerializable>,
  transaction extends Parameters<serializer>[0] = Parameters<serializer>[0],
> = TransactionSerialized<GetTransactionType<transaction>>


export type LedgerAccountT = LocalAccount<"ledger"> & HDOptions;

/**
 *  A **LedgerAccount** provides access to a Ledger Hardware Wallet
 *  as an Ethers Signer.
 */
export class LedgerAccount implements LedgerAccountT {
    // This configuration is used to resolve properties when trying to clear sign.
    // TODO: figure out what and how these are resolved exactly.
    public static readonly resolutionConfig = Object.freeze({
        domain: true,
        nft: true,
        erc20: true,
        plugin: true,
        externalPlugins: true,
    });

    public readonly source = "ledger";
    public readonly type = "local";
    public readonly path: string;

    accountIndex?: number;
    addressIndex?: number;
    changeIndex?: number;

    /**
     *  Create a new **LedgerAccount** connected to the device over the
     *  %%transport%% and optionally connected to the blockchain via
     *  %%provider%%. The %%path%% follows the same logic as
     *  [[LedgerAccount_getPath]], defaulting to the default HD path of
     *  ``m/44'/60'/0'/0/0``.
     */
    private constructor(
        public readonly address: Address,
        public readonly publicKey: Hex,
        path: Bip32Path,
    ) {
        this.path = path.normalized;
        if (Bip44PathIndices.Account < path.indices.length) {
            this.accountIndex = path.indices[Bip44PathIndices.Account];
        }
        if (Bip44PathIndices.Address < path.indices.length) {
            this.addressIndex = path.indices[Bip44PathIndices.Address];
        }
        if (Bip44PathIndices.Change < path.indices.length) {
            this.changeIndex = path.indices[Bip44PathIndices.Change];
        }
    }

    public static app: Eth;

    public static async create(path = defaultPath) {
        const bip32Path = parseBip32Path(path);
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

        const {address, publicKey} = await this.getAccount(bip32Path.normalized);
        return new LedgerAccount(address, publicKey, bip32Path);
    }

    private static readonly retry = retry(this, (error) => {
        // TODO: check if this error type is exported in some ledger library.
        if (error?.statusCode === 27404) {
            // TODO: define a custom error type for this?
            throw new Error(`Ledger device is not running Ethereum App`);
        }
    });

    /**
     *  Returns a new LedgerAccount connected via the same transport
     *  and provider, but using the account at the HD %%path%%.
     */
    // getSigner(path?: string | number): LedgerAccount {
    //     return new LedgerAccount(this.#transport, this.provider, path);
    // }

    public static async getAccount(path: string) {
        const cachedAccount = accountCache[path];
        if (cachedAccount !== undefined) return cachedAccount;

        const account = await this.retry((eth) => eth.getAddress(path));
        return accountCache[path] = {
            address: getAddress(account.address),
            publicKey: `0x${account.publicKey}`,
        };
    }

    async signTransaction<
        serializer extends SerializeTransactionFn<TransactionSerializable> = SerializeTransactionFn<TransactionSerializable>,
        transaction extends Parameters<serializer>[0] = Parameters<serializer>[0],
    >(transaction: transaction, options?: { serializer?: serializer }) {
        const serializer = options?.serializer ?? serializeTransaction;

        const signableTransaction = (() => {
            // For EIP-4844 Transactions, we want to sign the transaction payload body (tx_payload_body)
            // without the sidecars (ie. without the network wrapper).
            // See: https://github.com/ethereum/EIPs/blob/e00f4daa66bd56e2dbd5f1d36d09fd613811a48b/EIPS/eip-4844.md#networking
            if (transaction.type === 'eip4844')
                return {
                    ...transaction,
                    sidecars: false,
                };
            return transaction;
        })();

        const serializedTx = (await serializer(signableTransaction)).substring(2);
        const signature = await LedgerAccount.retry(
            (eth) => eth.clearSignTransaction(this.path, serializedTx, LedgerAccount.resolutionConfig)
        );
        return (await serializer(
            transaction,
            {
                r: signature.r as Hex,
                s: signature.s as Hex,
                v: BigInt(signature.v),
            },
        )) as SignTransactionReturnType<serializer, transaction>;
    }

    async signMessage({message}: {message: SignableMessage}): Promise<SignMessageReturnType> {
        if (typeof message === "string") {
            message = { raw: new TextEncoder().encode(message) };
        }
        if (!isHex(message.raw)) {
            message.raw = toHex(message.raw);
        }

        const messageHex = message.raw.substring(2);
        const sig = await LedgerAccount.retry((eth) => eth.signPersonalMessage(this.path, messageHex));

        // Serialize the signature
        return serializeSignature({
            r: `0x${sig.r}`,
            s: `0x${sig.s}`,
            v: BigInt(sig.v),
        });
    }

    async signTypedData<
        const typedData extends TypedData | Record<string, unknown>,
        primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
    >(
        typedMessage: TypedDataDefinition<typedData, primaryType>,
    ): Promise<SignTypedDataReturnType> {
        let sig: { r: string; s: string; v: number };
        try {
            // Try clear signing the EIP-712 message
            sig = await LedgerAccount.retry((eth) => eth.signEIP712Message(this.path, typedMessage as any));
        } catch (error) {
            // TODO: what error code is this? try to import it from library
            if ((error as any)?.statusCode !== 27904) throw error;

            // Older device; fallback onto signing raw hashes
            const domainHash = hashDomain({
                domain: typedMessage.domain as any,
                types: typedMessage.types,
            });
            const valueHash = hashTypedData(typedMessage);
            sig = await LedgerAccount.retry((eth) =>
                eth.signEIP712HashedMessage(this.path, domainHash.substring(2), valueHash.substring(2)),
            );
        }

        return serializeSignature({
            r: `0x${sig.r}`,
            s: `0x${sig.s}`,
            v: BigInt(sig.v),
        });
    }
}
