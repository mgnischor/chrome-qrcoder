/*
    QRCoder Chrome Extension
    Copyright (C) 2026 Miguel Nischor

    File: src/shared/draft.ts
    Description: Opt-in, memory-only copy of what was typed, so it survives closing the popup.
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
import { DEFAULT_FIELDS, WIFI_SECURITY_TYPES, type PayloadFields } from "../core/payload";

/** Longest text kept for one field. Well above what a QR code can hold, so nothing a user can use is cut. */
export const MAX_FIELD_LENGTH = 8000;

const STORAGE_KEY = "inputDraft";

/**
 * Resolves the storage area that holds the draft. It is looked up lazily so
 * that importing this module never touches `chrome` (for example in tests).
 *
 * `storage.session` is memory only: it is never written to disk and disappears
 * when the browser closes, which is the right lifetime for a Wi-Fi password
 * that was typed in to make a QR code.
 *
 * @returns The storage area used for the draft.
 */
const storageArea = () => chrome.storage.session;

/**
 * Turns untrusted stored data into valid fields. Every text must be a string of a sensible length and the
 * security type one of the known values; anything else falls back to the empty default.
 *
 * @param raw - Value read from storage.
 * @returns Valid fields.
 */
export function sanitizeDraft(raw: unknown): PayloadFields {
    const isRecord = typeof raw === "object" && raw !== null && !Array.isArray(raw);
    const input = (isRecord ? raw : {}) as Record<string, unknown>;
    const text = (value: unknown, fallback: string) =>
        typeof value === "string" && value.length <= MAX_FIELD_LENGTH ? value : fallback;

    return {
        link: text(input.link, DEFAULT_FIELDS.link),
        text: text(input.text, DEFAULT_FIELDS.text),
        ssid: text(input.ssid, DEFAULT_FIELDS.ssid),
        password: text(input.password, DEFAULT_FIELDS.password),
        security: WIFI_SECURITY_TYPES.find((type) => type === input.security) ?? DEFAULT_FIELDS.security,
        hidden: typeof input.hidden === "boolean" ? input.hidden : DEFAULT_FIELDS.hidden,
    };
}

/**
 * Reads the draft from storage.
 *
 * @returns The stored fields; empty defaults when none exist or storage is unavailable.
 */
export async function loadDraft(): Promise<PayloadFields> {
    try {
        const stored = await storageArea().get(STORAGE_KEY);
        return sanitizeDraft(stored[STORAGE_KEY]);
    } catch {
        return { ...DEFAULT_FIELDS };
    }
}

/**
 * Writes the draft to storage.
 *
 * @param fields - What was typed.
 */
export async function saveDraft(fields: PayloadFields): Promise<void> {
    await storageArea().set({ [STORAGE_KEY]: fields });
}

/** Deletes the draft. */
export async function clearDraft(): Promise<void> {
    await storageArea().remove(STORAGE_KEY);
}
