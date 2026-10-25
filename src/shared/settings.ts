/*
    QRCoder Chrome Extension
    Copyright (C) 2026 Miguel Nischor

    File: src/shared/settings.ts
    Description: Persisted user settings with validation and storage helpers.
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
import { PAYLOAD_KINDS, type PayloadKind } from "../core/payload";
import { ERROR_CORRECTION_LEVELS, type ErrorCorrection } from "../core/tables";

/** Sizes offered for saved and copied PNG images, in pixels. */
export const EXPORT_SIZES = [256, 512, 1024, 2048] as const;

/** Everything persisted between sessions. What was typed is kept separately and only in memory. */
export interface Settings {
    /** The tab that was open last. */
    kind: PayloadKind;
    errorCorrection: ErrorCorrection;
    /** Wanted width and height of saved and copied PNG images, one of {@link EXPORT_SIZES}. */
    exportSize: number;
    /** Keep what was typed (in memory only) so it is there when the popup reopens. */
    rememberInputs: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
    kind: "link",
    errorCorrection: "M",
    exportSize: 1024,
    rememberInputs: true,
};

const STORAGE_KEY = "settings";

/**
 * Turns untrusted stored data into valid settings. Unknown or malformed fields
 * fall back to their defaults so a corrupted store can never break the UI.
 *
 * @param raw - Value read from storage or assembled from form controls.
 * @returns Valid settings: a known tab, level and image size, and a typed flag.
 */
export function sanitizeSettings(raw: unknown): Settings {
    const isRecord = typeof raw === "object" && raw !== null && !Array.isArray(raw);
    const input = (isRecord ? raw : {}) as Record<string, unknown>;
    const defaults = DEFAULT_SETTINGS;

    return {
        kind: PAYLOAD_KINDS.find((kind) => kind === input.kind) ?? defaults.kind,
        errorCorrection: ERROR_CORRECTION_LEVELS.find((level) => level === input.errorCorrection) ?? defaults.errorCorrection,
        exportSize: EXPORT_SIZES.find((size) => size === input.exportSize) ?? defaults.exportSize,
        rememberInputs: typeof input.rememberInputs === "boolean" ? input.rememberInputs : defaults.rememberInputs,
    };
}

/**
 * Reads the settings from `chrome.storage.sync`.
 *
 * @returns The stored settings, or the defaults when none exist or storage is unavailable.
 */
export async function loadSettings(): Promise<Settings> {
    try {
        const stored = await chrome.storage.sync.get(STORAGE_KEY);
        return sanitizeSettings(stored[STORAGE_KEY]);
    } catch {
        return { ...DEFAULT_SETTINGS };
    }
}

/**
 * Writes the settings to `chrome.storage.sync`.
 *
 * @param settings - Settings to persist.
 */
export async function saveSettings(settings: Settings): Promise<void> {
    await chrome.storage.sync.set({ [STORAGE_KEY]: settings });
}
