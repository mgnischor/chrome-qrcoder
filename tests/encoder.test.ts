/*
    QRCoder Chrome Extension
    Copyright (C) 2026 Miguel Nischor

    File: tests/encoder.test.ts
    Description: Unit tests for the QR encoder, including round trips through an independent decoder.
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
import qrcodeGenerator from "qrcode-generator";
import { describe, expect, it } from "vitest";
import {
    QrError,
    dataCodewords,
    encode,
    formatBits,
    interleave,
    maxByteCapacity,
    penaltyScore,
    selectMode,
    versionBits,
    type QrCode,
} from "../src/core/encoder";
import { ERROR_CORRECTION_LEVELS, dataCodewordCount, type ErrorCorrection } from "../src/core/tables";
import { scan } from "./qr-image";

/**
 * Produces reproducible printable ASCII text.
 *
 * @param length - Number of characters.
 * @param seed - Seed of the generator.
 * @returns A string of `length` characters from space to tilde.
 */
function sampleText(length: number, seed: number): string {
    let state = seed >>> 0;
    let text = "";
    for (let i = 0; i < length; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        text += String.fromCharCode(32 + ((state >>> 16) % 95));
    }
    return text;
}

/**
 * Reads the 15 format bits back from the first copy next to the top-left finder pattern.
 *
 * @param qr - Symbol to read.
 * @returns The bits as written, before unmasking.
 */
function readFormat(qr: QrCode): number {
    const m = qr.modules;
    const bit = (x: number, y: number) => (m[y]![x] ? 1 : 0);
    let bits = 0;
    for (let i = 0; i <= 5; i++) bits |= bit(8, i) << i;
    bits |= bit(8, 7) << 6;
    bits |= bit(8, 8) << 7;
    bits |= bit(7, 8) << 8;
    for (let i = 9; i < 15; i++) bits |= bit(14 - i, 8) << i;
    return bits;
}

/**
 * Scores a symbol with the four penalty rules, written directly from the wording of the standard so that it
 * shares no structure with the implementation under test.
 *
 * @param m - The complete symbol.
 * @returns The total penalty.
 */
function referencePenalty(m: readonly (readonly boolean[])[]): number {
    const n = m.length;
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= n || y >= n ? false : m[y]![x]!); // outside is light
    let penalty = 0;

    // Rule 1: a run of five or more equal modules costs 3, plus 1 for each module beyond the fifth.
    for (const horizontal of [true, false]) {
        for (let line = 0; line < n; line++) {
            const module = (i: number) => (horizontal ? at(i, line) : at(line, i));
            for (let start = 0; start < n; ) {
                let end = start;
                while (end < n && module(end) === module(start)) end++;
                if (end - start >= 5) penalty += 3 + (end - start - 5);
                start = end;
            }
        }
    }

    // Rule 2: every 2x2 block of one colour costs 3.
    for (let y = 0; y < n - 1; y++) {
        for (let x = 0; x < n - 1; x++) {
            const c = at(x, y);
            if (at(x + 1, y) === c && at(x, y + 1) === c && at(x + 1, y + 1) === c) penalty += 3;
        }
    }

    // Rule 3: dark-light-dark-dark-dark-light-dark with four light modules before or after it costs 40 each.
    const core = [true, false, true, true, true, false, true];
    for (const horizontal of [true, false]) {
        for (let line = 0; line < n; line++) {
            const module = (i: number) => (horizontal ? at(i, line) : at(line, i));
            for (let s = -4; s < n; s++) {
                const isCore = (start: number) => core.every((dark, i) => module(start + i) === dark);
                if (isCore(s + 4) && [0, 1, 2, 3].every((i) => !module(s + i))) penalty += 40;
                if (isCore(s) && [7, 8, 9, 10].every((i) => !module(s + i))) penalty += 40;
            }
        }
    }

    // Rule 4: 10 points for each full 5% the share of dark modules differs from 50%.
    const dark = m.flat().filter(Boolean).length;
    penalty += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
    return penalty;
}

describe("selectMode", () => {
    it("picks the most compact mode", () => {
        expect(selectMode("0123456789")).toBe("numeric");
        expect(selectMode("HELLO WORLD $%*+-./:")).toBe("alphanumeric");
        expect(selectMode("Hello")).toBe("byte");
        expect(selectMode("https://example.com")).toBe("byte");
        expect(selectMode("HTTPS://EXAMPLE.COM")).toBe("alphanumeric");
        expect(selectMode("")).toBe("byte");
        expect(selectMode("12a")).toBe("byte");
    });
});

describe("dataCodewords (ISO/IEC 18004 worked examples)", () => {
    it("encodes 01234567 in version 1-M", () => {
        expect(dataCodewords("01234567", 1, "M", "numeric")).toEqual([
            16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17,
        ]);
    });

    it("encodes HELLO WORLD in version 1-Q", () => {
        expect(dataCodewords("HELLO WORLD", 1, "Q", "alphanumeric")).toEqual([
            32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236,
        ]);
    });

    it("always returns exactly the data capacity of the version", () => {
        for (const level of ERROR_CORRECTION_LEVELS) {
            expect(dataCodewords("a", 5, level, "byte")).toHaveLength(dataCodewordCount(5, level));
        }
    });

    it("rejects text that does not fit", () => {
        expect(() => dataCodewords("a".repeat(18), 1, "L", "byte")).toThrow(QrError);
    });
});

describe("interleave", () => {
    it("appends the error correction codewords of HELLO WORLD in version 1-Q", () => {
        const data = dataCodewords("HELLO WORLD", 1, "Q", "alphanumeric");
        expect(interleave(data, 1, "Q").slice(13)).toEqual([168, 72, 22, 82, 217, 54, 156, 0, 46, 15, 180, 122, 16]);
    });

    it("appends the error correction codewords of 01234567 in version 1-M", () => {
        const data = dataCodewords("01234567", 1, "M", "numeric");
        expect(interleave(data, 1, "M").slice(16)).toEqual([165, 36, 212, 193, 237, 54, 199, 135, 44, 85]);
    });

    it("interleaves blocks of different lengths in the order of the standard (version 5-Q)", () => {
        // Version 5-Q has two blocks of 15 and two of 16 data codewords, each with 18 error correction codewords.
        const data = Array.from({ length: 62 }, (_, i) => i);
        const result = interleave(data, 5, "Q");
        expect(result).toHaveLength(134);
        expect(result.slice(0, 8)).toEqual([0, 15, 30, 46, 1, 16, 31, 47]);
        // The 16th data codeword of the two long blocks comes after the 15 rounds of all four blocks.
        expect(result.slice(60, 62)).toEqual([45, 61]);
    });
});

describe("format and version information", () => {
    it("matches the values listed in the standard", () => {
        expect(formatBits("L", 0)).toBe(0b111011111000100);
        expect(formatBits("M", 0)).toBe(0b101010000010010);
        expect(formatBits("Q", 0)).toBe(0b011010101011111);
        expect(formatBits("H", 0)).toBe(0b001011010001001);
        expect(formatBits("M", 5)).toBe(0b100000011001110);
    });

    it("matches the version information of the standard", () => {
        expect(versionBits(7)).toBe(0b000111110010010100);
        expect(versionBits(8)).toBe(0b001000010110111100);
        expect(versionBits(40)).toBe(0b101000110001101001);
    });

    it("is written into the symbol", () => {
        for (const level of ERROR_CORRECTION_LEVELS) {
            for (let mask = 0; mask < 8; mask++) {
                expect(readFormat(encode("format", level, { mask }))).toBe(formatBits(level, mask));
            }
        }
    });
});

describe("symbol structure", () => {
    const qr = encode("https://example.com/structure", "M");
    const dark = (x: number, y: number) => qr.modules[y]![x]!;

    it("is square with the side length of its version", () => {
        expect(qr.size).toBe(qr.version * 4 + 17);
        expect(qr.modules).toHaveLength(qr.size);
        for (const row of qr.modules) expect(row).toHaveLength(qr.size);
    });

    it("has the three finder patterns", () => {
        for (const [ox, oy] of [
            [0, 0],
            [qr.size - 7, 0],
            [0, qr.size - 7],
        ] as const) {
            for (let dy = 0; dy < 7; dy++) {
                for (let dx = 0; dx < 7; dx++) {
                    const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
                    expect(dark(ox + dx, oy + dy), `${ox + dx},${oy + dy}`).toBe(ring !== 2);
                }
            }
        }
    });

    it("has light separators next to the finder patterns", () => {
        for (let i = 0; i < 8; i++) {
            expect(dark(7, i), "top left, right edge").toBe(false);
            expect(dark(i, 7), "top left, bottom edge").toBe(false);
            expect(dark(qr.size - 8, i), "top right, left edge").toBe(false);
            expect(dark(qr.size - 8 + i, 7), "top right, bottom edge").toBe(false);
            expect(dark(7, qr.size - 8 + i), "bottom left, right edge").toBe(false);
            expect(dark(i, qr.size - 8), "bottom left, top edge").toBe(false);
        }
    });

    it("has alternating timing patterns", () => {
        for (let i = 8; i < qr.size - 8; i++) {
            expect(dark(i, 6)).toBe(i % 2 === 0);
            expect(dark(6, i)).toBe(i % 2 === 0);
        }
    });

    it("has the always-dark module", () => {
        expect(dark(8, qr.size - 8)).toBe(true);
    });

    it("is deterministic", () => {
        expect(encode("https://example.com/structure", "M")).toEqual(qr);
    });
});

describe("version selection", () => {
    it("uses version 1 for short texts and grows only when needed", () => {
        expect(encode("HELLO WORLD", "Q").version).toBe(1);
        expect(encode("a".repeat(17), "L").version).toBe(1);
        expect(encode("a".repeat(18), "L").version).toBe(2);
    });

    it("needs a larger version for a higher error correction level", () => {
        const text = "a".repeat(40);
        const versions = ERROR_CORRECTION_LEVELS.map((level) => encode(text, level).version);
        expect([...versions].sort((a, b) => a - b)).toEqual(versions);
        expect(versions[3]).toBeGreaterThan(versions[0]!);
    });

    it("counts UTF-8 bytes, not characters", () => {
        expect(encode("é".repeat(9), "L").version).toBe(2); // 18 bytes
        expect(encode("é".repeat(8), "L").version).toBe(1); // 16 bytes
    });
});

describe("capacity", () => {
    it.each([
        ["L", 2953],
        ["M", 2331],
        ["Q", 1663],
        ["H", 1273],
    ] as const)("holds %s bytes at level %s in version 40", (level, bytes) => {
        expect(maxByteCapacity(level)).toBe(bytes);
        expect(encode("a".repeat(bytes), level).version).toBe(40);
        expect(() => encode("a".repeat(bytes + 1), level)).toThrow(QrError);
    });

    it("reports the failure with a code", () => {
        try {
            encode("a".repeat(3000), "L");
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(QrError);
            expect((error as QrError).code).toBe("TOO_LONG");
        }
    });

    it("fits more digits than letters", () => {
        expect(encode("1".repeat(7089), "L").version).toBe(40);
        expect(encode("A".repeat(4296), "L").version).toBe(40);
        expect(() => encode("1".repeat(7090), "L")).toThrow(QrError);
        expect(() => encode("A".repeat(4297), "L")).toThrow(QrError);
    });
});

describe("masks", () => {
    it("rejects a mask outside 0-7", () => {
        expect(() => encode("a", "L", { mask: 8 })).toThrow(RangeError);
        expect(() => encode("a", "L", { mask: -1 })).toThrow(RangeError);
        expect(() => encode("a", "L", { mask: 1.5 })).toThrow(RangeError);
    });

    it("chooses the mask with the lowest penalty", () => {
        const text = "https://example.com/masks";
        const best = encode(text, "M");
        const scores = Array.from({ length: 8 }, (_, mask) => penaltyScore(encode(text, "M", { mask }).modules));
        expect(scores[best.mask]).toBe(Math.min(...scores));
        expect(scores.indexOf(Math.min(...scores))).toBe(best.mask);
    });

    it("scores symbols like the reference implementation of the rules", () => {
        const texts = ["a", "https://example.com/some/long/path?x=1&y=2", "0123456789".repeat(8), "A".repeat(200), "é日本語".repeat(20)];
        for (const text of texts) {
            for (const level of ERROR_CORRECTION_LEVELS) {
                for (let mask = 0; mask < 8; mask++) {
                    const qr = encode(text, level, { mask });
                    expect(penaltyScore(qr.modules), `${text.slice(0, 10)} ${level}${mask}`).toBe(referencePenalty(qr.modules));
                }
            }
        }
    });

    it("scores a blank symbol much worse than a real one", () => {
        const blank = Array.from({ length: 21 }, () => new Array<boolean>(21).fill(false));
        expect(penaltyScore(blank)).toBeGreaterThan(penaltyScore(encode("x", "L").modules));
    });
});

describe("round trip through an independent decoder", () => {
    it.each(ERROR_CORRECTION_LEVELS)("decodes every data mask at level %s", (level) => {
        for (let mask = 0; mask < 8; mask++) {
            const text = `mask ${mask} at level ${level}`;
            expect(scan(encode(text, level, { mask }))?.text, `mask ${mask}`).toBe(text);
        }
    });

    it("decodes numeric, alphanumeric and byte mode", () => {
        for (const text of ["0", "12", "123", "0123456789012345678901234567890", "HELLO WORLD", "A", "AB", "ABC", "$%*+-./: 09"]) {
            expect(scan(encode(text, "M"))?.text, text).toBe(text);
        }
        expect(scan(encode("lowercase and 123", "M"))?.text).toBe("lowercase and 123");
    });

    it("decodes UTF-8 text byte for byte", () => {
        for (const text of ["café", "日本語のテキスト", "Привет, мир!", "emoji 😀🔒", "ñandú — “quotes”"]) {
            const result = scan(encode(text, "Q"));
            expect(result, text).not.toBeNull();
            expect(Array.from(result!.bytes), text).toEqual(Array.from(new TextEncoder().encode(text)));
        }
    });

    // jsQR cannot read version 23-L, not even when the symbol comes from another generator (checked against
    // qrcode-generator). That one symbol is covered by the comparison with the reference generator below.
    const DECODER_BLIND_SPOT = { version: 23, level: "L" };

    // Every version at every level, once just full and once barely over the capacity of the version below, so
    // that a wrong entry in the capacity or block tables (any of the 160) cannot go unnoticed.
    it.each(ERROR_CORRECTION_LEVELS)("decodes all 40 versions at level %s", (level: ErrorCorrection) => {
        for (let version = 1; version <= 40; version++) {
            const full = Math.floor((dataCodewordCount(version, level) * 8 - 4 - (version <= 9 ? 8 : 16)) / 8);
            const lowest = version === 1 ? 1 : Math.floor((dataCodewordCount(version - 1, level) * 8 - 4 - (version - 1 <= 9 ? 8 : 16)) / 8) + 1;
            const readable = !(version === DECODER_BLIND_SPOT.version && level === DECODER_BLIND_SPOT.level);
            for (const length of new Set([full, lowest])) {
                const text = `a${sampleText(length - 1, version * 31 + length)}`; // the "a" forces byte mode
                const qr = encode(text, level);
                expect(qr.version, `v${version} length ${length}`).toBe(version);
                if (readable) expect(scan(qr)?.text, `v${version}-${level} length ${length}`).toBe(text);
            }
        }
    }, 120_000);
});

describe("agreement with an independent generator", () => {
    // qrcode-generator shares no code with the encoder. Its mask choice can differ (the standard leaves room for
    // equally valid choices), so a symbol agrees when some mask of ours reproduces it module for module. That
    // covers every table entry, the block interleaving, the module placement and the format and version bits.
    it.each(ERROR_CORRECTION_LEVELS)("reproduces all 40 versions at level %s", (level: ErrorCorrection) => {
        for (let version = 1; version <= 40; version++) {
            const length = Math.floor((dataCodewordCount(version, level) * 8 - 4 - (version <= 9 ? 8 : 16)) / 8);
            const text = "a".repeat(length);

            const reference = qrcodeGenerator(version as Parameters<typeof qrcodeGenerator>[0], level);
            reference.addData(text, "Byte");
            reference.make();
            const matches = (qr: QrCode) =>
                qr.size === reference.getModuleCount() &&
                qr.modules.every((row, y) => row.every((dark, x) => dark === reference.isDark(y, x)));

            const ours = encode(text, level);
            expect(ours.version, `v${version}-${level}`).toBe(version);
            const agrees = matches(ours) || Array.from({ length: 8 }, (_, mask) => encode(text, level, { mask })).some(matches);
            expect(agrees, `v${version}-${level} differs from the reference generator for every mask`).toBe(true);
        }
    }, 60_000);
});
