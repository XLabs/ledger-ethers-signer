
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

