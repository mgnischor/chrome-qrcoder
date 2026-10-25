/*
    QRCoder Chrome Extension
    Copyright (C) 2026 Miguel Nischor

    File: src/core/reed-solomon.ts
    Description: Reed-Solomon error correction over GF(256), as used by QR codes.
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

/** Reducing polynomial of the QR code field: x^8 + x^4 + x^3 + x^2 + 1. */
const FIELD_POLYNOMIAL = 0x11d;

/** `EXP[i]` is alpha^i, doubled in length so that products of two logarithms need no modulo. */
const EXP = new Uint8Array(510);

/** `LOG[v]` is the exponent `i` for which alpha^i = `v`. `LOG[0]` is unused. */
const LOG = new Uint8Array(256);

{
    let value = 1;
    for (let i = 0; i < 255; i++) {
        EXP[i] = value;
        LOG[value] = i;
        value <<= 1;
        if (value & 0x100) value ^= FIELD_POLYNOMIAL;
    }
    for (let i = 255; i < 510; i++) EXP[i] = EXP[i - 255];
}

/**
 * Multiplies two elements of GF(256).
 *
 * @param a - First factor, 0 to 255.
 * @param b - Second factor, 0 to 255.
 * @returns The product in the field.
 */
export function multiply(a: number, b: number): number {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
}

/**
 * Builds the generator polynomial of a given degree, (x - alpha^0)(x - alpha^1)...(x - alpha^(degree-1)).
 *
 * @param degree - Number of error correction codewords, 1 to 255.
 * @returns The coefficients from the highest power down, without the leading 1 (which is implied).
 * @throws RangeError when `degree` is out of range.
 */
export function generatorPolynomial(degree: number): Uint8Array {
    if (!Number.isInteger(degree) || degree < 1 || degree > 255) throw new RangeError("Degree out of range");
    const coefficients = new Uint8Array(degree);
    coefficients[degree - 1] = 1; // start from the polynomial "1"
    let root = 1;
    for (let i = 0; i < degree; i++) {
        // Multiply the running polynomial by (x - root).
        for (let j = 0; j < degree; j++) {
            coefficients[j] = multiply(coefficients[j], root);
            if (j + 1 < degree) coefficients[j] ^= coefficients[j + 1];
        }
        root = multiply(root, 2);
    }
    return coefficients;
}

/**
 * Computes the Reed-Solomon error correction codewords of a block of data.
 *
 * @param data - Data codewords of one block.
 * @param degree - Number of error correction codewords to produce.
 * @returns The `degree` error correction codewords.
 */
export function remainder(data: readonly number[], degree: number): Uint8Array {
    const divisor = generatorPolynomial(degree);
    const result = new Uint8Array(degree);
    for (const byte of data) {
        const factor = byte ^ result[0];
        result.copyWithin(0, 1);
        result[degree - 1] = 0;
        for (let i = 0; i < degree; i++) result[i] ^= multiply(divisor[i], factor);
    }
    return result;
}
