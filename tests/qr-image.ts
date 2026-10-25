/*
    QRCoder Chrome Extension
    Copyright (C) 2026 Miguel Nischor

    File: tests/qr-image.ts
    Description: Test helper that rasterises a QR code and reads it back with an independent decoder.
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
import jsQR from "jsqr";
import type { QrCode } from "../src/core/encoder";

/**
 * Draws a QR code as black modules on a white background, with the four-module quiet zone around it.
 *
 * @param qr - The code to draw.
 * @param scale - Pixels per module.
 * @returns RGBA pixels in the shape the decoder expects.
 */
export function rasterise(qr: QrCode, scale = 4): { data: Uint8ClampedArray; width: number; height: number } {
    const side = (qr.size + 8) * scale;
    const data = new Uint8ClampedArray(side * side * 4).fill(255);
    for (let y = 0; y < qr.size; y++) {
        for (let x = 0; x < qr.size; x++) {
            if (!qr.modules[y]![x]) continue;
            for (let py = 0; py < scale; py++) {
                for (let px = 0; px < scale; px++) {
                    const offset = (((y + 4) * scale + py) * side + (x + 4) * scale + px) * 4;
                    data[offset] = data[offset + 1] = data[offset + 2] = 0;
                }
            }
        }
    }
    return { data, width: side, height: side };
}

/**
 * Scans a QR code the way a phone would, with a decoder that shares no code with the encoder.
 *
 * @param qr - The code to scan.
 * @returns The decoded text and bytes, or `null` when the decoder could not read the code.
 */
export function scan(qr: QrCode): { text: string; bytes: Uint8Array } | null {
    const image = rasterise(qr);
    const result = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
    return result ? { text: result.data, bytes: Uint8Array.from(result.binaryData) } : null;
}
