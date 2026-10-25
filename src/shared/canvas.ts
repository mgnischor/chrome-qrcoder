/*
    QRCoder Chrome Extension
    Copyright (C) 2026 Miguel Nischor

    File: src/shared/canvas.ts
    Description: Draws QR codes on a canvas and turns them into PNG images.
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
import type { QrCode } from "../core/encoder";
import { QUIET_ZONE, darkRuns } from "../core/svg";

/** The part of a 2D canvas context the painter needs. Narrow on purpose, so tests can pass a recorder. */
export type PaintContext = Pick<CanvasRenderingContext2D, "fillRect" | "fillStyle">;

/**
 * Picks the size of a PNG: a whole number of pixels per module, so that every module is exactly as wide as the
 * others, as close as possible to (but not above) the size the user asked for.
 *
 * @param qr - The code to draw.
 * @param targetPixels - Wanted width and height in pixels.
 * @param border - Quiet zone in modules.
 * @returns The width and height in pixels, at least one pixel per module.
 */
export function pngSize(qr: QrCode, targetPixels: number, border = QUIET_ZONE): number {
    const modules = qr.size + border * 2;
    return modules * Math.max(1, Math.floor(targetPixels / modules));
}

/**
 * Paints a QR code, quiet zone included: black modules on a white background. Modules are laid out on rounded
 * pixel boundaries, so neighbours always touch and no hairline gaps appear at fractional sizes.
 *
 * @param context - Canvas context to paint on.
 * @param qr - The code to draw.
 * @param pixels - Width and height of the canvas in pixels.
 * @param border - Quiet zone in modules.
 */
export function paintQr(context: PaintContext, qr: QrCode, pixels: number, border = QUIET_ZONE): void {
    const unit = pixels / (qr.size + border * 2);
    const edge = (modules: number) => Math.round(modules * unit);

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, pixels, pixels);
    context.fillStyle = "#000000";
    for (const { x, y, length } of darkRuns(qr)) {
        const left = edge(x + border);
        const top = edge(y + border);
        context.fillRect(left, top, edge(x + border + length) - left, edge(y + border + 1) - top);
    }
}

/**
 * Renders a QR code to a PNG image.
 *
 * @param qr - The code to draw.
 * @param targetPixels - Wanted width and height; the real size is the closest whole number of pixels per module.
 * @returns The PNG file.
 * @throws Error when the browser cannot create the canvas or the image.
 */
export async function renderPng(qr: QrCode, targetPixels: number): Promise<Blob> {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = pngSize(qr, targetPixels);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is not available");
    paintQr(context, qr, canvas.width);

    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not create the image"))), "image/png");
    });
}
