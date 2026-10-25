/*
    QRCoder Chrome Extension
    Copyright (C) 2026 Miguel Nischor

    File: tests/settings.test.ts
    Description: Unit tests for settings validation and storage.
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
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    DEFAULT_SETTINGS,
    EXPORT_SIZES,
    loadSettings,
    sanitizeSettings,
    saveSettings,
    type Settings,
} from "../src/shared/settings";

describe("sanitizeSettings", () => {
    it("keeps valid settings as they are", () => {
        const settings: Settings = { kind: "wifi", errorCorrection: "H", exportSize: 2048, rememberInputs: false };
        expect(sanitizeSettings(settings)).toEqual(settings);
    });

    it("falls back to the defaults for anything that is not an object", () => {
        for (const raw of [undefined, null, "x", 5, true, [], [{ kind: "wifi" }]]) {
            expect(sanitizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
        }
    });

    it("replaces unknown or mistyped values, field by field", () => {
        expect(
            sanitizeSettings({ kind: "sms", errorCorrection: "X", exportSize: 999, rememberInputs: "yes" })
        ).toEqual(DEFAULT_SETTINGS);
        expect(sanitizeSettings({ kind: "text", errorCorrection: "nope" })).toEqual({
            ...DEFAULT_SETTINGS,
            kind: "text",
        });
    });

    it("accepts every offered image size and nothing in between", () => {
        for (const size of EXPORT_SIZES) expect(sanitizeSettings({ exportSize: size }).exportSize).toBe(size);
        for (const size of [0, 100, 513, "512", NaN, Infinity]) {
            expect(sanitizeSettings({ exportSize: size }).exportSize).toBe(DEFAULT_SETTINGS.exportSize);
        }
    });

    it("drops fields it does not know", () => {
        expect(Object.keys(sanitizeSettings({ ...DEFAULT_SETTINGS, extra: 1 })).sort()).toEqual(
            Object.keys(DEFAULT_SETTINGS).sort()
        );
    });

    it("starts with a link, medium error correction and the roomiest sensible image", () => {
        expect(DEFAULT_SETTINGS).toEqual({ kind: "link", errorCorrection: "M", exportSize: 1024, rememberInputs: true });
        expect(EXPORT_SIZES).toContain(DEFAULT_SETTINGS.exportSize);
    });
});

describe("storage", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("reads and writes chrome.storage.sync under one key", async () => {
        const sync = {
            get: vi.fn().mockResolvedValue({ settings: { kind: "text", errorCorrection: "L" } }),
            set: vi.fn().mockResolvedValue(undefined),
        };
        vi.stubGlobal("chrome", { storage: { sync } });

        expect(await loadSettings()).toEqual({ ...DEFAULT_SETTINGS, kind: "text", errorCorrection: "L" });
        expect(sync.get).toHaveBeenCalledWith("settings");
        await saveSettings(DEFAULT_SETTINGS);
        expect(sync.set).toHaveBeenCalledWith({ settings: DEFAULT_SETTINGS });
    });

    it("loads the defaults when nothing was stored", async () => {
        vi.stubGlobal("chrome", { storage: { sync: { get: vi.fn().mockResolvedValue({}) } } });
        expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    });

    it("loads the defaults when storage fails", async () => {
        vi.stubGlobal("chrome", { storage: { sync: { get: vi.fn().mockRejectedValue(new Error("no")) } } });
        expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    });
});
