/*
    QRCoder Chrome Extension
    Copyright (C) 2026 Miguel Nischor

    File: tests/svg.test.ts
    Description: Unit tests for the SVG renderer.
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
import { encode, type QrCode } from "../src/core/encoder";
import { QUIET_ZONE, darkRuns, toSvg } from "../src/core/svg";

/**
 * Reads the dark modules back out of an SVG made by `toSvg`.
 *
 * @param svg - The SVG source.
 * @returns The side length in modules (quiet zone included) and the set of dark `x,y` cells in that space.
 */
function parseSvg(svg: string): { side: number; dark: Set<string> } {
    const side = Number(/viewBox="0 0 (\d+) \1"/.exec(svg)![1]);
    const dark = new Set<string>();
    const path = /<path d="([^"]*)"/.exec(svg)![1]!;
    for (const [, x, y, length] of path.matchAll(/M(\d+),(\d+)h(\d+)v1h-\3z/g)) {
        for (let i = 0; i < Number(length); i++) dark.add(`${Number(x) + i},${y}`);
    }
    return { side, dark };
}

/**
 * Lists the dark modules of a QR code in the same coordinates as {@link parseSvg}.
 *
 * @param qr - The code.
 * @param border - Quiet zone in modules.
 * @returns The dark cells as `x,y` strings.
 */
function darkCells(qr: QrCode, border: number): Set<string> {
    const cells = new Set<string>();
    qr.modules.forEach((row, y) => row.forEach((dark, x) => dark && cells.add(`${x + border},${y + border}`)));
    return cells;
}

describe("darkRuns", () => {
    const qr = encode("https://example.com/runs", "M");

    it("covers every dark module exactly once", () => {
        const cells = new Set<string>();
        let total = 0;
        for (const { x, y, length } of darkRuns(qr)) {
            for (let i = 0; i < length; i++) cells.add(`${x + i},${y}`);
            total += length;
        }
        expect(total).toBe(cells.size);
        expect(cells).toEqual(darkCells(qr, 0));
    });

    it("never splits a run in two or ends one next to another", () => {
        const runs = darkRuns(qr);
        for (const run of runs) {
            expect(run.length).toBeGreaterThan(0);
            expect(runs.some((other) => other.y === run.y && other.x === run.x + run.length)).toBe(false);
        }
    });
});

describe("toSvg", () => {
    const qr = encode("https://example.com/svg", "Q");
    const svg = toSvg(qr);

    it("is a standalone SVG document with the SVG namespace", () => {
        expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" ')).toBe(true);
        expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    });

    it("draws exactly the dark modules of the code, inside the quiet zone", () => {
        const { side, dark } = parseSvg(svg);
        expect(side).toBe(qr.size + QUIET_ZONE * 2);
        expect(dark).toEqual(darkCells(qr, QUIET_ZONE));
    });

    it("paints a white background first, so the code scans on any page", () => {
        expect(svg).toMatch(/<rect width="\d+" height="\d+" fill="#fff"\/>/);
        expect(svg.indexOf("<rect")).toBeLessThan(svg.indexOf("<path"));
    });

    it("honours a custom quiet zone", () => {
        const { side, dark } = parseSvg(toSvg(qr, 2));
        expect(side).toBe(qr.size + 4);
        expect(dark).toEqual(darkCells(qr, 2));
    });

    it("contains no script, links or external references", () => {
        expect(svg).not.toMatch(/<script|href=|xlink|<image|<use|onload|javascript:/i);
        expect(svg.match(/https?:\/\/[^"]+/g)).toEqual(["http://www.w3.org/2000/svg"]);
    });

    it("is deterministic and much smaller than one element per module", () => {
        expect(toSvg(qr)).toBe(svg);
        expect(svg.length).toBeLessThan(qr.size * qr.size * 4);
    });
});
