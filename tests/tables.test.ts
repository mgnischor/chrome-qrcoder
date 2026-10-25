/*
    QRCoder Chrome Extension
    Copyright (C) 2026 Miguel Nischor

    File: tests/tables.test.ts
    Description: Unit tests for the version, capacity and error correction tables.
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
import { describe, expect, it } from "vitest";
import {
    ERROR_CORRECTION_LEVELS,
    MAX_VERSION,
    MIN_VERSION,
    alignmentPositions,
    blockLayout,
    dataCodewordCount,
    dataModuleCount,
    symbolSize,
    totalCodewords,
} from "../src/core/tables";

const VERSIONS = Array.from({ length: MAX_VERSION }, (_, i) => i + 1);

describe("symbolSize", () => {
    it("grows by 4 modules per version", () => {
        expect(symbolSize(1)).toBe(21);
        expect(symbolSize(2)).toBe(25);
        expect(symbolSize(40)).toBe(177);
    });

    it("rejects versions outside 1-40", () => {
        for (const version of [0, 41, -1, 1.5, NaN]) expect(() => symbolSize(version)).toThrow(RangeError);
    });
});

describe("totalCodewords", () => {
    it("matches the capacity table of the standard", () => {
        const expected: Record<number, number> = {
            1: 26,
            2: 44,
            3: 70,
            4: 100,
            5: 134,
            6: 172,
            7: 196,
            8: 242,
            9: 292,
            10: 346,
            20: 1085,
            30: 2185,
            40: 3706,
        };
        for (const [version, codewords] of Object.entries(expected)) {
            expect(totalCodewords(Number(version)), `version ${version}`).toBe(codewords);
        }
    });

    it("is the data module count divided into bytes, with at most 7 remainder bits", () => {
        for (const version of VERSIONS) {
            const remainderBits = dataModuleCount(version) - totalCodewords(version) * 8;
            expect(remainderBits, `version ${version}`).toBeGreaterThanOrEqual(0);
            expect(remainderBits, `version ${version}`).toBeLessThanOrEqual(7);
        }
    });
});

describe("alignmentPositions", () => {
    it("matches the positions listed in the standard", () => {
        expect(alignmentPositions(1)).toEqual([]);
        expect(alignmentPositions(2)).toEqual([6, 18]);
        expect(alignmentPositions(7)).toEqual([6, 22, 38]);
        expect(alignmentPositions(14)).toEqual([6, 26, 46, 66]);
        expect(alignmentPositions(32)).toEqual([6, 34, 60, 86, 112, 138]);
        expect(alignmentPositions(40)).toEqual([6, 30, 58, 86, 114, 142, 170]);
    });

    it("stays inside the symbol and ends 7 modules from the edge", () => {
        for (const version of VERSIONS.slice(1)) {
            const positions = alignmentPositions(version);
            expect(positions[0]).toBe(6);
            expect(positions.at(-1)).toBe(symbolSize(version) - 7);
            expect([...positions].sort((a, b) => a - b)).toEqual(positions);
        }
    });
});

describe("dataCodewordCount", () => {
    it("matches the capacity table of the standard", () => {
        const expected: Record<number, readonly number[]> = {
            // [L, M, Q, H]
            1: [19, 16, 13, 9],
            5: [108, 86, 62, 46],
            10: [274, 216, 154, 122],
            40: [2956, 2334, 1666, 1276],
        };
        for (const [version, counts] of Object.entries(expected)) {
            ERROR_CORRECTION_LEVELS.forEach((level, i) => {
                expect(dataCodewordCount(Number(version), level), `${version}-${level}`).toBe(counts[i]);
            });
        }
    });

    it("never grows with a higher error correction level, and always grows with the version", () => {
        for (const version of VERSIONS) {
            const counts = ERROR_CORRECTION_LEVELS.map((level) => dataCodewordCount(version, level));
            expect([...counts].sort((a, b) => b - a), `version ${version}`).toEqual(counts);
            if (version > MIN_VERSION) {
                ERROR_CORRECTION_LEVELS.forEach((level) => {
                    expect(dataCodewordCount(version, level)).toBeGreaterThan(dataCodewordCount(version - 1, level));
                });
            }
        }
    });
});

describe("blockLayout", () => {
    it("accounts for every codeword of every version and level", () => {
        for (const version of VERSIONS) {
            for (const level of ERROR_CORRECTION_LEVELS) {
                const { blocks, eccPerBlock, shortDataLength, longBlocks } = blockLayout(version, level);
                const where = `${version}-${level}`;
                expect(longBlocks, where).toBeLessThan(blocks);
                expect(shortDataLength, where).toBeGreaterThan(0);
                expect(blocks * (shortDataLength + eccPerBlock) + longBlocks, where).toBe(totalCodewords(version));
                expect(blocks * shortDataLength + longBlocks, where).toBe(dataCodewordCount(version, level));
            }
        }
    });

    it("splits version 5-Q into two short and two long blocks", () => {
        expect(blockLayout(5, "Q")).toEqual({ blocks: 4, eccPerBlock: 18, shortDataLength: 15, longBlocks: 2 });
    });
});
