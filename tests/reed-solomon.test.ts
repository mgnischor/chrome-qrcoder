/*
    QRCoder Chrome Extension
    Copyright (C) 2026 Miguel Nischor

    File: tests/reed-solomon.test.ts
    Description: Unit tests for the GF(256) arithmetic and the Reed-Solomon error correction.
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
import { generatorPolynomial, multiply, remainder } from "../src/core/reed-solomon";

/**
 * Computes alpha^n in GF(256) by repeated doubling.
 *
 * @param n - Exponent.
 * @returns The field element alpha^n.
 */
function alphaPower(n: number): number {
    let value = 1;
    for (let i = 0; i < n; i++) value = multiply(value, 2);
    return value;
}

describe("multiply", () => {
    it("reduces by the field polynomial 0x11d", () => {
        expect(multiply(2, 2)).toBe(4);
        expect(multiply(0x80, 2)).toBe(0x1d);
        expect(multiply(0x57, 0x83)).toBe(multiply(0x83, 0x57));
    });

    it("has 0 as the absorbing element and 1 as the identity", () => {
        for (let a = 0; a < 256; a++) {
            expect(multiply(a, 0)).toBe(0);
            expect(multiply(0, a)).toBe(0);
            expect(multiply(a, 1)).toBe(a);
        }
    });

    it("is commutative and associative", () => {
        for (let a = 1; a < 256; a += 17) {
            for (let b = 1; b < 256; b += 13) {
                expect(multiply(a, b)).toBe(multiply(b, a));
                for (let c = 1; c < 256; c += 31) {
                    expect(multiply(multiply(a, b), c)).toBe(multiply(a, multiply(b, c)));
                }
            }
        }
    });

    it("has a multiplicative order of 255: alpha^255 is 1 and no smaller power is", () => {
        expect(alphaPower(255)).toBe(1);
        const seen = new Set(Array.from({ length: 255 }, (_, n) => alphaPower(n)));
        expect(seen.size).toBe(255);
    });
});

describe("generatorPolynomial", () => {
    it("matches the degree 7 polynomial listed in the standard", () => {
        // x^7 + a^87 x^6 + a^229 x^5 + a^146 x^4 + a^149 x^3 + a^238 x^2 + a^102 x + a^21
        const exponents = [87, 229, 146, 149, 238, 102, 21];
        expect(Array.from(generatorPolynomial(7))).toEqual(exponents.map(alphaPower));
    });

    it("has the right length and, evaluated at alpha^i, vanishes for every root", () => {
        for (const degree of [1, 2, 10, 30]) {
            const coefficients = generatorPolynomial(degree);
            expect(coefficients).toHaveLength(degree);
            for (let i = 0; i < degree; i++) {
                const x = alphaPower(i);
                let value = 1; // the implied leading coefficient
                for (const coefficient of coefficients) value = multiply(value, x) ^ coefficient;
                expect(value, `degree ${degree}, root alpha^${i}`).toBe(0);
            }
        }
    });

    it("rejects degrees outside 1-255", () => {
        for (const degree of [0, -1, 256, 1.5, NaN]) expect(() => generatorPolynomial(degree)).toThrow(RangeError);
    });
});

describe("remainder", () => {
    it("is all zeros for all-zero data", () => {
        expect(Array.from(remainder([0, 0, 0, 0], 10))).toEqual(new Array(10).fill(0));
    });

    it("is linear: the remainder of an XOR is the XOR of the remainders", () => {
        const a = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236];
        const b = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
        const ra = remainder(a, 13);
        const rb = remainder(b, 13);
        const rx = remainder(
            a.map((byte, i) => byte ^ b[i]!),
            13
        );
        expect(Array.from(rx)).toEqual(Array.from(ra, (byte, i) => byte ^ rb[i]!));
    });

    it("makes data plus remainder divisible by the generator (every root evaluates to zero)", () => {
        const data = [16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17];
        const codeword = [...data, ...remainder(data, 10)];
        for (let i = 0; i < 10; i++) {
            const x = alphaPower(i);
            expect(codeword.reduce((value, byte) => multiply(value, x) ^ byte, 0), `root alpha^${i}`).toBe(0);
        }
    });
});
