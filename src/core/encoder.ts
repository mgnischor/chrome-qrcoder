/*
    QRCoder Chrome Extension
    Copyright (C) 2026 Miguel Nischor

    File: src/core/encoder.ts
    Description: QR code encoder: mode selection, data and error correction codewords, and symbol layout.
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
import { remainder } from "./reed-solomon";
import {
    MAX_VERSION,
    MIN_VERSION,
    alignmentPositions,
    blockLayout,
    dataCodewordCount,
    symbolSize,
    type ErrorCorrection,
} from "./tables";

/** How the characters of the text are packed into bits. */
export type Mode = "numeric" | "alphanumeric" | "byte";

/** A finished QR code. */
export interface QrCode {
    /** Version 1 to 40; the symbol is `version * 4 + 17` modules on each side. */
    readonly version: number;
    /** Modules per side. */
    readonly size: number;
    readonly errorCorrection: ErrorCorrection;
    /** The data mask pattern, 0 to 7, that gave the lowest penalty. */
    readonly mask: number;
    readonly mode: Mode;
    /** `modules[y][x]` is `true` for a dark module. The quiet zone is not included. */
    readonly modules: readonly (readonly boolean[])[];
}

export interface EncodeOptions {
    /** Force a data mask (0 to 7) instead of choosing the best one. Meant for tests. */
    mask?: number;
}

export type QrErrorCode = "TOO_LONG";

/** Error thrown when text cannot be encoded. */
export class QrError extends Error {
    /**
     * @param code - Machine-readable reason, used by the UI to pick a localized message.
     * @param message - English description, meant for logs and debugging.
     */
    constructor(
        readonly code: QrErrorCode,
        message: string
    ) {
        super(message);
        this.name = "QrError";
    }
}

/** The 45 characters of alphanumeric mode, in the order that gives each its value. */
const ALPHANUMERIC_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

/** Mode indicator bits (4 bits each). */
const MODE_BITS: Readonly<Record<Mode, number>> = { numeric: 0b0001, alphanumeric: 0b0010, byte: 0b0100 };

/** Width of the character count field, for versions 1-9, 10-26 and 27-40. */
const COUNT_BITS: Readonly<Record<Mode, readonly [number, number, number]>> = {
    numeric: [10, 12, 14],
    alphanumeric: [9, 11, 13],
    byte: [8, 16, 16],
};

/** Padding codewords alternated after the data until the symbol is full. */
const PAD_BYTES = [0xec, 0x11] as const;

/** Format information bits of each error correction level. */
const FORMAT_LEVEL_BITS: Readonly<Record<ErrorCorrection, number>> = { L: 1, M: 0, Q: 3, H: 2 };

/** The 11-module patterns the third penalty rule looks for: a finder-like 1:1:3:1:1 run next to 4 light modules. */
const FINDER_LIKE_AFTER = toPattern("10111010000");
const FINDER_LIKE_BEFORE = toPattern("00001011101");

/** Penalty weights of the four mask evaluation rules. */
const PENALTY_RUN = 3;
const PENALTY_BLOCK = 3;
const PENALTY_FINDER_LIKE = 40;
const PENALTY_BALANCE = 10;

/**
 * Converts a string of 0s and 1s to booleans.
 *
 * @param bits - Pattern such as `"1011"`.
 * @returns `true` for each `1`.
 */
function toPattern(bits: string): boolean[] {
    return [...bits].map((bit) => bit === "1");
}

/**
 * Picks the most compact mode that can represent a text.
 *
 * @param text - Text to encode.
 * @returns `numeric` for digits only, `alphanumeric` for the 45-character set, otherwise `byte`.
 */
export function selectMode(text: string): Mode {
    if (text === "") return "byte";
    if (/^[0-9]+$/.test(text)) return "numeric";
    if ([...text].every((ch) => ALPHANUMERIC_CHARS.includes(ch))) return "alphanumeric";
    return "byte";
}

/** Growable sequence of bits, most significant bit first. */
class BitBuffer {
    readonly bits: number[] = [];

    /**
     * Appends the low `length` bits of a value.
     *
     * @param value - Non-negative integer.
     * @param length - Number of bits to write, 0 to 31.
     */
    append(value: number, length: number): void {
        for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
    }
}

/**
 * Returns the largest number of bytes (UTF-8) a QR code can hold at an error correction level.
 *
 * @param level - Error correction level.
 * @returns Capacity of a version 40 symbol in byte mode.
 */
export function maxByteCapacity(level: ErrorCorrection): number {
    const bits = dataCodewordCount(MAX_VERSION, level) * 8 - 4 - COUNT_BITS.byte[2];
    return Math.floor(bits / 8);
}

/**
 * Counts the bits needed for the data of a text, without header.
 *
 * @param mode - Packing mode.
 * @param length - Number of characters (numeric, alphanumeric) or bytes (byte).
 * @returns Number of data bits.
 */
function dataBitLength(mode: Mode, length: number): number {
    switch (mode) {
        case "numeric":
            return Math.floor(length / 3) * 10 + [0, 4, 7][length % 3]!;
        case "alphanumeric":
            return Math.floor(length / 2) * 11 + (length % 2) * 6;
        case "byte":
            return length * 8;
    }
}

/**
 * Chooses the width of the character count field.
 *
 * @param mode - Packing mode.
 * @param version - QR code version, 1 to 40.
 * @returns Number of bits of the count field.
 */
function countBits(mode: Mode, version: number): number {
    return COUNT_BITS[mode][version <= 9 ? 0 : version <= 26 ? 1 : 2];
}

/**
 * Builds the data codewords of a symbol: mode, character count, data, terminator and padding.
 *
 * @param text - Text to encode. Non-ASCII characters are written as UTF-8.
 * @param version - QR code version, 1 to 40.
 * @param level - Error correction level.
 * @param mode - Packing mode, as chosen by {@link selectMode}.
 * @returns Exactly {@link dataCodewordCount} codewords.
 * @throws QrError when the text does not fit in this version.
 */
export function dataCodewords(text: string, version: number, level: ErrorCorrection, mode: Mode): number[] {
    const buffer = new BitBuffer();
    const bytes = new TextEncoder().encode(text);
    const length = mode === "byte" ? bytes.length : text.length;

    buffer.append(MODE_BITS[mode], 4);
    buffer.append(length, countBits(mode, version));
    if (mode === "numeric") {
        for (let i = 0; i < text.length; i += 3) {
            const group = text.slice(i, i + 3);
            buffer.append(Number(group), group.length * 3 + 1);
        }
    } else if (mode === "alphanumeric") {
        for (let i = 0; i < text.length; i += 2) {
            const first = ALPHANUMERIC_CHARS.indexOf(text[i]!);
            if (i + 1 < text.length) buffer.append(first * 45 + ALPHANUMERIC_CHARS.indexOf(text[i + 1]!), 11);
            else buffer.append(first, 6);
        }
    } else {
        for (const byte of bytes) buffer.append(byte, 8);
    }

    const capacityBits = dataCodewordCount(version, level) * 8;
    if (buffer.bits.length > capacityBits) throw new QrError("TOO_LONG", "The text does not fit in this version");

    buffer.append(0, Math.min(4, capacityBits - buffer.bits.length)); // terminator
    buffer.append(0, (8 - (buffer.bits.length % 8)) % 8); // align to a codeword boundary

    const codewords: number[] = [];
    for (let i = 0; i < buffer.bits.length; i += 8) {
        codewords.push(buffer.bits.slice(i, i + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
    }
    for (let pad = 0; codewords.length < capacityBits / 8; pad++) codewords.push(PAD_BYTES[pad % 2]!);
    return codewords;
}

/**
 * Splits the data into blocks, adds error correction to each and interleaves them as the standard requires.
 *
 * @param data - Data codewords from {@link dataCodewords}.
 * @param version - QR code version, 1 to 40.
 * @param level - Error correction level.
 * @returns The final sequence of codewords to place in the symbol.
 */
export function interleave(data: readonly number[], version: number, level: ErrorCorrection): number[] {
    const { blocks, eccPerBlock, shortDataLength, longBlocks } = blockLayout(version, level);
    const firstLong = blocks - longBlocks;

    const dataBlocks: number[][] = [];
    let offset = 0;
    for (let i = 0; i < blocks; i++) {
        const length = shortDataLength + (i >= firstLong ? 1 : 0);
        dataBlocks.push(data.slice(offset, offset + length));
        offset += length;
    }
    const eccBlocks = dataBlocks.map((block) => [...remainder(block, eccPerBlock)]);

    const result: number[] = [];
    for (let i = 0; i <= shortDataLength; i++) {
        for (const block of dataBlocks) if (i < block.length) result.push(block[i]!);
    }
    for (let i = 0; i < eccPerBlock; i++) {
        for (const block of eccBlocks) result.push(block[i]!);
    }
    return result;
}

/**
 * Computes the 15 format information bits: level and mask, protected by a BCH code, then XORed with a fixed mask.
 *
 * @param level - Error correction level.
 * @param mask - Data mask pattern, 0 to 7.
 * @returns The 15-bit value as written in the symbol.
 */
export function formatBits(level: ErrorCorrection, mask: number): number {
    const data = (FORMAT_LEVEL_BITS[level] << 3) | mask;
    let remainderBits = data;
    for (let i = 0; i < 10; i++) remainderBits = (remainderBits << 1) ^ ((remainderBits >>> 9) * 0x537);
    return ((data << 10) | remainderBits) ^ 0x5412;
}

/**
 * Computes the 18 version information bits written in symbols of version 7 and above.
 *
 * @param version - QR code version, 7 to 40.
 * @returns The version number followed by its BCH error correction bits.
 */
export function versionBits(version: number): number {
    let remainderBits = version;
    for (let i = 0; i < 12; i++) remainderBits = (remainderBits << 1) ^ ((remainderBits >>> 11) * 0x1f25);
    return (version << 12) | remainderBits;
}

/** A square grid of modules together with the set of modules reserved for function patterns. */
interface Grid {
    readonly size: number;
    readonly modules: boolean[][];
    /** `true` where a function pattern lives, so data and masks must not touch it. */
    readonly reserved: boolean[][];
}

/**
 * Creates an empty grid.
 *
 * @param size - Modules per side.
 * @returns A grid with every module light and unreserved.
 */
function createGrid(size: number): Grid {
    const square = () => Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    return { size, modules: square(), reserved: square() };
}

/**
 * Sets a module and reserves it as a function module.
 *
 * @param grid - Grid to modify.
 * @param x - Column.
 * @param y - Row.
 * @param dark - Module colour.
 */
function setFunction(grid: Grid, x: number, y: number, dark: boolean): void {
    grid.modules[y]![x] = dark;
    grid.reserved[y]![x] = true;
}

/**
 * Draws a finder pattern with its separator, centred at a position.
 *
 * @param grid - Grid to modify.
 * @param cx - Column of the centre module.
 * @param cy - Row of the centre module.
 */
function drawFinder(grid: Grid, cx: number, cy: number): void {
    for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
            const x = cx + dx;
            const y = cy + dy;
            if (x < 0 || y < 0 || x >= grid.size || y >= grid.size) continue;
            const distance = Math.max(Math.abs(dx), Math.abs(dy));
            // Rings: dark centre block (0-1), light ring (2), dark ring (3), light separator (4).
            setFunction(grid, x, y, distance !== 2 && distance !== 4);
        }
    }
}

/**
 * Draws an alignment pattern centred at a position.
 *
 * @param grid - Grid to modify.
 * @param cx - Column of the centre module.
 * @param cy - Row of the centre module.
 */
function drawAlignment(grid: Grid, cx: number, cy: number): void {
    for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) setFunction(grid, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
}

/**
 * Writes the format information twice, plus the always-dark module next to it.
 *
 * @param grid - Grid to modify.
 * @param level - Error correction level.
 * @param mask - Data mask pattern, 0 to 7.
 */
function drawFormat(grid: Grid, level: ErrorCorrection, mask: number): void {
    const bits = formatBits(level, mask);
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    const size = grid.size;

    // First copy, around the top-left finder pattern.
    for (let i = 0; i <= 5; i++) setFunction(grid, 8, i, bit(i));
    setFunction(grid, 8, 7, bit(6));
    setFunction(grid, 8, 8, bit(7));
    setFunction(grid, 7, 8, bit(8));
    for (let i = 9; i < 15; i++) setFunction(grid, 14 - i, 8, bit(i));

    // Second copy, split between the top-right and bottom-left finder patterns.
    for (let i = 0; i < 8; i++) setFunction(grid, size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) setFunction(grid, 8, size - 15 + i, bit(i));
    setFunction(grid, 8, size - 8, true);
}

/**
 * Writes the version information twice (versions 7 and above).
 *
 * @param grid - Grid to modify.
 * @param version - QR code version, 7 to 40.
 */
function drawVersion(grid: Grid, version: number): void {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
        const dark = ((bits >>> i) & 1) === 1;
        const a = grid.size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        setFunction(grid, a, b, dark);
        setFunction(grid, b, a, dark);
    }
}

/**
 * Draws every function pattern: timing, finder, alignment, and the format and version information.
 *
 * @param grid - Grid to modify.
 * @param version - QR code version, 1 to 40.
 * @param level - Error correction level.
 */
function drawFunctionPatterns(grid: Grid, version: number, level: ErrorCorrection): void {
    const size = grid.size;
    for (let i = 0; i < size; i++) {
        setFunction(grid, 6, i, i % 2 === 0);
        setFunction(grid, i, 6, i % 2 === 0);
    }
    drawFinder(grid, 3, 3);
    drawFinder(grid, size - 4, 3);
    drawFinder(grid, 3, size - 4);

    const positions = alignmentPositions(version);
    const last = positions.length - 1;
    positions.forEach((cx, i) => {
        positions.forEach((cy, j) => {
            // The three corners that coincide with a finder pattern get no alignment pattern.
            if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
            drawAlignment(grid, cx, cy);
        });
    });

    drawFormat(grid, level, 0); // reserves the area; the real mask is written once it is chosen
    if (version >= 7) drawVersion(grid, version);
}

/**
 * Places the codewords in the zigzag order of the standard, two columns at a time, from the bottom right.
 *
 * @param grid - Grid to modify.
 * @param codewords - Final codewords from {@link interleave}.
 */
function placeCodewords(grid: Grid, codewords: readonly number[]): void {
    const size = grid.size;
    let bitIndex = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5; // the vertical timing pattern is skipped
        const upward = ((right + 1) & 2) === 0;
        for (let step = 0; step < size; step++) {
            const y = upward ? size - 1 - step : step;
            for (let j = 0; j < 2; j++) {
                const x = right - j;
                if (grid.reserved[y]![x] || bitIndex >= codewords.length * 8) continue;
                grid.modules[y]![x] = ((codewords[bitIndex >>> 3]! >>> (7 - (bitIndex & 7))) & 1) === 1;
                bitIndex++;
            }
        }
    }
}

/**
 * Tells whether the mask pattern inverts a module.
 *
 * @param mask - Data mask pattern, 0 to 7.
 * @param x - Column.
 * @param y - Row.
 * @returns `true` when the module at (`x`, `y`) is flipped.
 */
function isMasked(mask: number, x: number, y: number): boolean {
    switch (mask) {
        case 0:
            return (x + y) % 2 === 0;
        case 1:
            return y % 2 === 0;
        case 2:
            return x % 3 === 0;
        case 3:
            return (x + y) % 3 === 0;
        case 4:
            return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
        case 5:
            return ((x * y) % 2) + ((x * y) % 3) === 0;
        case 6:
            return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
        case 7:
            return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        default:
            throw new RangeError(`Mask out of range: ${mask}`);
    }
}

/**
 * Flips the data modules selected by a mask. Applying the same mask twice restores the grid.
 *
 * @param grid - Grid to modify.
 * @param mask - Data mask pattern, 0 to 7.
 */
function applyMask(grid: Grid, mask: number): void {
    for (let y = 0; y < grid.size; y++) {
        for (let x = 0; x < grid.size; x++) {
            if (!grid.reserved[y]![x] && isMasked(mask, x, y)) grid.modules[y]![x] = !grid.modules[y]![x];
        }
    }
}

/**
 * Scores a row or column with the first and third penalty rules.
 *
 * @param line - Module colours along the line.
 * @returns Penalty for runs of five or more equal modules, plus finder-like patterns.
 */
function linePenalty(line: readonly boolean[]): number {
    let penalty = 0;

    let run = 1;
    for (let i = 1; i <= line.length; i++) {
        if (i < line.length && line[i] === line[i - 1]) {
            run++;
            continue;
        }
        if (run >= 5) penalty += PENALTY_RUN + (run - 5);
        run = 1;
    }

    // The area outside the symbol counts as light, so a pattern at the edge is penalised too.
    const padded = [false, false, false, false, ...line, false, false, false, false];
    const matches = (start: number, pattern: readonly boolean[]) => pattern.every((dark, k) => padded[start + k] === dark);
    for (let start = 0; start + 11 <= padded.length; start++) {
        if (matches(start, FINDER_LIKE_AFTER)) penalty += PENALTY_FINDER_LIKE;
        if (matches(start, FINDER_LIKE_BEFORE)) penalty += PENALTY_FINDER_LIKE;
    }
    return penalty;
}

/**
 * Scores a masked symbol with the four evaluation rules of the standard. Lower is better.
 *
 * @param modules - The complete symbol, format information included.
 * @returns The total penalty.
 */
export function penaltyScore(modules: readonly (readonly boolean[])[]): number {
    const size = modules.length;
    let penalty = 0;

    for (let i = 0; i < size; i++) {
        penalty += linePenalty(modules[i]!);
        penalty += linePenalty(modules.map((row) => row[i]!));
    }

    let dark = 0;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (modules[y]![x]) dark++;
            if (x + 1 < size && y + 1 < size) {
                const colour = modules[y]![x];
                if (colour === modules[y]![x + 1] && colour === modules[y + 1]![x] && colour === modules[y + 1]![x + 1]) {
                    penalty += PENALTY_BLOCK;
                }
            }
        }
    }

    // Every full 5% the share of dark modules strays from 50% costs 10 points.
    const total = size * size;
    penalty += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * PENALTY_BALANCE;
    return penalty;
}

/**
 * Tries every data mask and picks the one with the lowest penalty. Ties go to the lowest mask number.
 *
 * @param grid - Grid holding the function patterns and the unmasked data. It is left as it was found.
 * @param level - Error correction level, needed to draw the format information that is part of the score.
 * @returns The best mask pattern, 0 to 7.
 */
function chooseMask(grid: Grid, level: ErrorCorrection): number {
    let best = 0;
    let lowest = Infinity;
    for (let candidate = 0; candidate < 8; candidate++) {
        applyMask(grid, candidate);
        drawFormat(grid, level, candidate);
        const penalty = penaltyScore(grid.modules);
        applyMask(grid, candidate); // undo
        if (penalty < lowest) {
            lowest = penalty;
            best = candidate;
        }
    }
    return best;
}

/**
 * Encodes text as a QR code. The smallest version that fits is used; the error correction level is exactly
 * the one requested.
 *
 * @param text - Text to encode. Characters outside ASCII are written as UTF-8 bytes.
 * @param level - Error correction level.
 * @param options - Optional settings; see {@link EncodeOptions}.
 * @returns The finished symbol.
 * @throws QrError when the text is too long for any version at this level.
 * @throws RangeError when a forced mask is not 0 to 7.
 */
export function encode(text: string, level: ErrorCorrection, options: EncodeOptions = {}): QrCode {
    if (options.mask !== undefined && !(Number.isInteger(options.mask) && options.mask >= 0 && options.mask <= 7)) {
        throw new RangeError(`Mask out of range: ${options.mask}`);
    }

    const mode = selectMode(text);
    const length = mode === "byte" ? new TextEncoder().encode(text).length : text.length;
    let version = MIN_VERSION;
    while (
        4 + countBits(mode, version) + dataBitLength(mode, length) > dataCodewordCount(version, level) * 8
    ) {
        if (version === MAX_VERSION) throw new QrError("TOO_LONG", "The text does not fit in any version");
        version++;
    }

    const codewords = interleave(dataCodewords(text, version, level, mode), version, level);
    const grid = createGrid(symbolSize(version));
    drawFunctionPatterns(grid, version, level);
    placeCodewords(grid, codewords);

    const mask = options.mask ?? chooseMask(grid, level);
    applyMask(grid, mask);
    drawFormat(grid, level, mask);

    return { version, size: grid.size, errorCorrection: level, mask, mode, modules: grid.modules };
}
