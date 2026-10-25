/*
    QRCoder Chrome Extension
    Copyright (C) 2026 Miguel Nischor

    File: src/core/tables.ts
    Description: Version, capacity and error correction tables defined by the QR code standard (ISO/IEC 18004).
    Author: Miguel Nischor <miguel@nischor.com.br>

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
*/

/** The four error correction levels, from the least to the most redundancy. */
export const ERROR_CORRECTION_LEVELS = ["L", "M", "Q", "H"] as const;

export type ErrorCorrection = (typeof ERROR_CORRECTION_LEVELS)[number];

export const MIN_VERSION = 1;
export const MAX_VERSION = 40;

/**
 * Error correction codewords in each block, by level and then by version (index 0 is unused).
 * Every block of a version has the same number of them.
 */
const ECC_CODEWORDS_PER_BLOCK: Readonly<Record<ErrorCorrection, readonly number[]>> = {
    L: [
        -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30,
        30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    ],
    M: [
        -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28,
        28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
    ],
    Q: [
        -1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30,
        30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    ],
    H: [
        -1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30,
        30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
    ],
};

/** Number of error correction blocks, by level and then by version (index 0 is unused). */
const BLOCK_COUNT: Readonly<Record<ErrorCorrection, readonly number[]>> = {
    L: [
        -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18,
        19, 19, 20, 21, 22, 24, 25,
    ],
    M: [
        -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29,
        31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
    ],
    Q: [
        -1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38,
        40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
    ],
    H: [
        -1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45,
        48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
    ],
};

/**
 * Checks that a version number is valid.
 *
 * @param version - Value to check.
 * @throws RangeError when `version` is not an integer from 1 to 40.
 */
function assertVersion(version: number): void {
    if (!Number.isInteger(version) || version < MIN_VERSION || version > MAX_VERSION) {
        throw new RangeError(`Version out of range: ${version}`);
    }
}

/**
 * Returns the side length of a symbol.
 *
 * @param version - QR code version, 1 to 40.
 * @returns Modules per side: 21 for version 1, up to 177 for version 40.
 */
export function symbolSize(version: number): number {
    assertVersion(version);
    return version * 4 + 17;
}

/**
 * Returns the centre coordinates of the alignment patterns along one axis.
 *
 * @param version - QR code version, 1 to 40.
 * @returns Ascending coordinates; empty for version 1. Combine them pairwise for the pattern centres.
 */
export function alignmentPositions(version: number): number[] {
    const size = symbolSize(version);
    if (version === 1) return [];
    const count = Math.floor(version / 7) + 2;
    // Version 32 is the one irregular case: the standard spaces it by 26 instead of the computed 28.
    const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
    const positions = [6];
    for (let position = size - 7; positions.length < count; position -= step) positions.splice(1, 0, position);
    return positions;
}

/**
 * Counts the modules that can hold data or error correction bits, i.e. everything except the
 * finder, timing and alignment patterns, the format and version information, and the dark module.
 *
 * @param version - QR code version, 1 to 40.
 * @returns The number of data modules, remainder bits included.
 */
export function dataModuleCount(version: number): number {
    assertVersion(version);
    let count = (16 * version + 128) * version + 64;
    if (version >= 2) {
        const alignment = Math.floor(version / 7) + 2;
        count -= (25 * alignment - 10) * alignment - 55;
        if (version >= 7) count -= 36; // the two version information blocks
    }
    return count;
}

/**
 * Returns the total number of codewords (data plus error correction) of a version.
 *
 * @param version - QR code version, 1 to 40.
 * @returns Whole 8-bit codewords; up to 7 leftover modules are remainder bits.
 */
export function totalCodewords(version: number): number {
    return Math.floor(dataModuleCount(version) / 8);
}

/**
 * Returns how the codewords of a version are split into error correction blocks.
 *
 * @param version - QR code version, 1 to 40.
 * @param level - Error correction level.
 * @returns The block count, the error correction codewords per block, and the data codewords of the
 *   short blocks. The last `longBlocks` blocks hold one more data codeword than the others.
 */
export function blockLayout(
    version: number,
    level: ErrorCorrection
): { blocks: number; eccPerBlock: number; shortDataLength: number; longBlocks: number } {
    assertVersion(version);
    const blocks = BLOCK_COUNT[level][version];
    const eccPerBlock = ECC_CODEWORDS_PER_BLOCK[level][version];
    const total = totalCodewords(version);
    return {
        blocks,
        eccPerBlock,
        shortDataLength: Math.floor(total / blocks) - eccPerBlock,
        longBlocks: total % blocks,
    };
}

/**
 * Returns how many data codewords a version holds at an error correction level.
 *
 * @param version - QR code version, 1 to 40.
 * @param level - Error correction level.
 * @returns Number of 8-bit data codewords.
 */
export function dataCodewordCount(version: number, level: ErrorCorrection): number {
    assertVersion(version);
    return totalCodewords(version) - BLOCK_COUNT[level][version] * ECC_CODEWORDS_PER_BLOCK[level][version];
}
