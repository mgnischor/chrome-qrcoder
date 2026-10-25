/*
    QRCoder Chrome Extension
    Copyright (C) 2026 Miguel Nischor

    File: tests/canvas.test.ts
    Description: Unit tests for painting QR codes on a canvas.
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
import jsQR from "jsqr";
import { encode, type QrCode } from "../src/core/encoder";
import { QUIET_ZONE } from "../src/core/svg";
import { paintQr, pngSize, type PaintContext } from "../src/shared/canvas";

/** A canvas context that rasterises `fillRect` calls into a black and white bitmap. */
class BitmapContext implements PaintContext {
    fillStyle = "#000000";
    readonly pixels: Uint8ClampedArray;

    /**
     * @param side - Width and height in pixels.
     */
    constructor(readonly side: number) {
        this.pixels = new Uint8ClampedArray(side * side * 4).fill(255);
    }

    /**
     * Fills a rectangle with the current colour (white or black only).
     *
     * @param x - Left edge.
     * @param y - Top edge.
     * @param width - Width.
     * @param height - Height.
     */
    fillRect(x: number, y: number, width: number, height: number): void {
        const value = this.fillStyle === "#ffffff" ? 255 : 0;
        expect(Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(width) && Number.isInteger(height)).toBe(true);
        for (let py = y; py < y + height; py++) {
            for (let px = x; px < x + width; px++) {
                const offset = (py * this.side + px) * 4;
                this.pixels[offset] = this.pixels[offset + 1] = this.pixels[offset + 2] = value;
            }
        }
    }

    /**
     * Reads one pixel.
     *
     * @param x - Column.
     * @param y - Row.
     * @returns `true` when the pixel is black.
     */
    isBlack(x: number, y: number): boolean {
        return this.pixels[(y * this.side + x) * 4] === 0;
    }
}

/**
 * Paints a code and returns the bitmap.
 *
 * @param qr - The code.
 * @param side - Canvas size in pixels.
 * @returns The painted bitmap.
 */
function paint(qr: QrCode, side: number): BitmapContext {
    const context = new BitmapContext(side);
    paintQr(context, qr, side);
    return context;
}

describe("pngSize", () => {
    const qr = encode("https://example.com/png", "M"); // 29 modules + 8 of quiet zone = 37
    const modules = qr.size + QUIET_ZONE * 2;

    it("uses a whole number of pixels per module, never above the target", () => {
        for (const target of [256, 512, 1024, 2048]) {
            const size = pngSize(qr, target);
            expect(size % modules).toBe(0);
            expect(size).toBeLessThanOrEqual(target);
            expect(size + modules).toBeGreaterThan(target);
        }
    });

    it("never goes below one pixel per module", () => {
        expect(pngSize(qr, 10)).toBe(modules);
        expect(pngSize(qr, 0)).toBe(modules);
    });
});

describe("paintQr", () => {
    const qr = encode("https://example.com/paint", "Q");
    const modules = qr.size + QUIET_ZONE * 2;

    it("paints white first, then the dark modules in black", () => {
        const calls: { style: string; rect: number[] }[] = [];
        const context: PaintContext = {
            fillStyle: "",
            fillRect(...rect) {
                calls.push({ style: String(this.fillStyle), rect });
            },
        };
        paintQr(context, qr, modules * 4);
        expect(calls[0]).toEqual({ style: "#ffffff", rect: [0, 0, modules * 4, modules * 4] });
        expect(calls.slice(1).every((call) => call.style === "#000000")).toBe(true);
    });

    it("gives every module the same square of pixels at a whole number of pixels per module", () => {
        const scale = 5;
        const bitmap = paint(qr, modules * scale);
        for (let y = 0; y < modules; y++) {
            for (let x = 0; x < modules; x++) {
                const expected = qr.modules[y - QUIET_ZONE]?.[x - QUIET_ZONE] === true;
                for (let py = 0; py < scale; py++) {
                    for (let px = 0; px < scale; px++) {
                        expect(bitmap.isBlack(x * scale + px, y * scale + py), `module ${x},${y}`).toBe(expected);
                    }
                }
            }
        }
    });

    it("keeps the quiet zone white", () => {
        const side = modules * 5;
        const bitmap = paint(qr, side);
        const border = QUIET_ZONE * 5;
        for (let i = 0; i < side; i++) {
            for (let j = 0; j < border; j++) {
                expect(bitmap.isBlack(i, j)).toBe(false);
                expect(bitmap.isBlack(i, side - 1 - j)).toBe(false);
                expect(bitmap.isBlack(j, i)).toBe(false);
                expect(bitmap.isBlack(side - 1 - j, i)).toBe(false);
            }
        }
    });

    it("keeps every module's centre correct at sizes that do not divide evenly (high-density screens)", () => {
        for (const side of [modules * 3 + 1, 300, 441, 513]) {
            const bitmap = paint(qr, side);
            const unit = side / modules;
            for (let y = 0; y < qr.size; y++) {
                for (let x = 0; x < qr.size; x++) {
                    const cx = Math.floor((x + QUIET_ZONE + 0.5) * unit);
                    const cy = Math.floor((y + QUIET_ZONE + 0.5) * unit);
                    expect(bitmap.isBlack(cx, cy), `${side}px, module ${x},${y}`).toBe(qr.modules[y]![x]);
                }
            }
        }
    });

    it("produces an image a scanner can read, at whole and fractional sizes", () => {
        for (const side of [modules * 4, 311]) {
            const bitmap = paint(qr, side);
            expect(jsQR(bitmap.pixels, side, side)?.data, `${side}px`).toBe("https://example.com/paint");
        }
    });
});
