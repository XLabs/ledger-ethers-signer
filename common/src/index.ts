
export enum Bip44PathIndices {
    Account = 2,
    Address = 3,
    Change = 4,
}

// will fit in uint32 range
export type Bip32Index = number;
export type Bip32Path = {
    /** Ledger-friendly path string without "m/" */
    normalized: string;
    /** Indices with hardened offset applied */
    indices: Bip32Index[];
};

const HARDENED_OFFSET = 0x80000000;

/**
 * The purpose behind this parser is to cover Ledger's overly tolerant BIP32 path parser.
 * See here https://github.com/LedgerHQ/ledger-live/blob/865cd0bfe4dd9b73e2b376bfa79330123655ab4e/libs/ledgerjs/packages/hw-app-eth/src/utils.ts#L30
 * Inspired in @scure/bip32's implementation but made slightly stricter
 */
export function parseBip32Path(path: string): Bip32Path {
    if (!/^m/.test(path)) {
        throw new Error('Path must start with "m"');
    }
    if (/^m$/.test(path)) {
        return {
            normalized: "",
            indices: [],
        };
    }
    const normalized = path.replace(/^m\//, '');
    const parts = normalized.split('/');
    const indices: number[] = parts.map((segment) => {
        const m = /^(\d+)('?)$/.exec(segment);
        const m1 = m && m[1];
        if (!m || m.length !== 3 || typeof m1 !== 'string')
            throw new Error(`Invalid child index: ${segment}`);
        let idx = +m1;
        if (!Number.isSafeInteger(idx) || idx >= HARDENED_OFFSET) {
            throw new Error('Node index out of range');
        }
        // hardened key
        if (m[2] === "'") {
            idx += HARDENED_OFFSET;
        }
        return idx;
    })
    return { normalized, indices };
}

export function sleep(duration: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, duration);
    });
}

interface AppContainer<App> {
    app: App;
}

// Currying the ledger application here allows creation of a function specific to a signer implementation.
// Using the AppContainer interface guards against the pitfall of passing in a bare reference that is then evaluated eagerly to undefined
// and thus breaks lazy initialization of the ledger application.
export const retry = <App>(container: AppContainer<App>, errorHook?: (error: any) => void) =>
    async <Result = any>(operation: (app: App) => Promise<Result>): Promise<Result> => {
        // Wait up to 120 seconds
        for (let i = 0; i < 1200; i++) {
            try {
                const result = await operation(container.app);
                return result;
            } catch (error: any) {
                // Let signer implementation inspect error and throw early
                if (errorHook !== undefined) errorHook(error);
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
