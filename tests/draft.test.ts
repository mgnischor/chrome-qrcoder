/*
    QRCoder Chrome Extension
    Copyright (C) 2026 Miguel Nischor

    File: tests/draft.test.ts
    Description: Unit tests for the memory-only copy of what was typed.
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
import { DEFAULT_FIELDS, type PayloadFields } from "../src/core/payload";
import { MAX_FIELD_LENGTH, clearDraft, loadDraft, sanitizeDraft, saveDraft } from "../src/shared/draft";

const typed: PayloadFields = {
    link: "example.com",
    text: "hello\nworld",
    ssid: "Home",
    password: "secret123",
    security: "WEP",
    hidden: true,
};

describe("sanitizeDraft", () => {
    it("keeps valid fields as they are", () => {
        expect(sanitizeDraft(typed)).toEqual(typed);
    });

    it("returns empty fields for anything that is not an object", () => {
        for (const raw of [undefined, null, "x", 5, [], [typed]]) expect(sanitizeDraft(raw)).toEqual(DEFAULT_FIELDS);
    });

    it("drops values of the wrong type or length, field by field", () => {
        const draft = sanitizeDraft({
            link: 5,
            text: "x".repeat(MAX_FIELD_LENGTH + 1),
            ssid: "Home",
            password: null,
            security: "WPA3-Enterprise",
            hidden: "true",
        });
        expect(draft).toEqual({ ...DEFAULT_FIELDS, ssid: "Home" });
    });

    it("accepts text of exactly the maximum length", () => {
        const text = "x".repeat(MAX_FIELD_LENGTH);
        expect(sanitizeDraft({ text }).text).toBe(text);
    });

    it("drops fields it does not know", () => {
        expect(Object.keys(sanitizeDraft({ ...typed, extra: "x" })).sort()).toEqual(Object.keys(typed).sort());
    });
});

describe("storage", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("uses the memory-only session area, never sync or local", async () => {
        const session = {
            get: vi.fn().mockResolvedValue({ inputDraft: typed }),
            set: vi.fn().mockResolvedValue(undefined),
            remove: vi.fn().mockResolvedValue(undefined),
        };
        const other = { get: vi.fn(), set: vi.fn(), remove: vi.fn() };
        vi.stubGlobal("chrome", { storage: { session, local: other, sync: other } });

        expect(await loadDraft()).toEqual(typed);
        await saveDraft(typed);
        expect(session.set).toHaveBeenCalledWith({ inputDraft: typed });
        await clearDraft();
        expect(session.remove).toHaveBeenCalledWith("inputDraft");
        for (const fn of Object.values(other)) expect(fn).not.toHaveBeenCalled();
    });

    it("loads empty fields when nothing was stored or storage fails", async () => {
        vi.stubGlobal("chrome", { storage: { session: { get: vi.fn().mockResolvedValue({}) } } });
        expect(await loadDraft()).toEqual(DEFAULT_FIELDS);
        vi.stubGlobal("chrome", { storage: { session: { get: vi.fn().mockRejectedValue(new Error("no")) } } });
        expect(await loadDraft()).toEqual(DEFAULT_FIELDS);
    });
});
