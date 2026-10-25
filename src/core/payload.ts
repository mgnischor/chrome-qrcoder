/*
    QRCoder Chrome Extension
    Copyright (C) 2026 Miguel Nischor

    File: src/core/payload.ts
    Description: Turns what the user typed (a link, plain text or Wi-Fi details) into the text a QR code carries.
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

/** The kinds of content the popup can turn into a QR code. */
export const PAYLOAD_KINDS = ["link", "text", "wifi"] as const;

export type PayloadKind = (typeof PAYLOAD_KINDS)[number];

/** Wi-Fi security types of the `WIFI:` format. `nopass` is an open network. */
export const WIFI_SECURITY_TYPES = ["WPA", "WEP", "nopass"] as const;

export type WifiSecurity = (typeof WIFI_SECURITY_TYPES)[number];

/** Longest network name: 32 bytes, as defined by IEEE 802.11. */
export const MAX_SSID_BYTES = 32;

/** Shortest and longest WPA passphrase, in bytes. A 64-digit hexadecimal key is also accepted. */
export const MIN_WPA_PASSWORD_BYTES = 8;
export const MAX_WPA_PASSWORD_BYTES = 63;

/** Everything the user can type, whichever kind is showing. */
export interface PayloadFields {
    link: string;
    text: string;
    ssid: string;
    password: string;
    security: WifiSecurity;
    hidden: boolean;
}

export const DEFAULT_FIELDS: Readonly<PayloadFields> = {
    link: "",
    text: "",
    ssid: "",
    password: "",
    security: "WPA",
    hidden: false,
};

export type PayloadErrorCode =
    | "EMPTY"
    | "INVALID_URL"
    | "SSID_TOO_LONG"
    | "PASSWORD_REQUIRED"
    | "PASSWORD_LENGTH";

/** Error thrown when the fields cannot be turned into a QR code. */
export class PayloadError extends Error {
    /**
     * @param code - Machine-readable reason, used by the UI to pick a localized message.
     * @param message - English description, meant for logs and debugging.
     */
    constructor(
        readonly code: PayloadErrorCode,
        message: string
    ) {
        super(message);
        this.name = "PayloadError";
    }
}

/**
 * Counts the bytes of a string once encoded as UTF-8.
 *
 * @param text - Text to measure.
 * @returns The number of bytes.
 */
function byteLength(text: string): number {
    return new TextEncoder().encode(text).length;
}

/**
 * Turns what the user typed into a web address.
 *
 * An address without a scheme gets `https://`. Only `http` and `https` are accepted: other schemes such as
 * `javascript:`, `data:` or `mailto:` are rejected rather than silently turned into a different address.
 *
 * @param input - Text typed by the user, for example `example.com/menu` or `https://example.com`.
 * @returns The normalized address, as the browser would write it.
 * @throws PayloadError `EMPTY` when nothing was typed, or `INVALID_URL` when it is not a web address.
 */
export function normalizeUrl(input: string): string {
    const typed = input.trim();
    if (typed === "") throw new PayloadError("EMPTY", "No address");

    let candidate = typed;
    if (!/^https?:\/\//i.test(typed)) {
        // "host:8080" is an address with a port; "mailto:x" or "javascript:x" is some other scheme.
        if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(typed)) throw new PayloadError("INVALID_URL", "Unsupported scheme");
        candidate = `https://${typed}`;
    }

    let url: URL;
    try {
        url = new URL(candidate);
    } catch {
        throw new PayloadError("INVALID_URL", "Not a valid web address");
    }
    if (url.hostname === "") throw new PayloadError("INVALID_URL", "The address has no host");
    return url.href;
}

/**
 * Escapes a value of the `WIFI:` format: backslash, semicolon, comma, colon and double quote each get a backslash.
 *
 * @param value - SSID or password.
 * @returns The escaped value.
 */
export function escapeWifiValue(value: string): string {
    return value.replace(/[\\;,:"]/g, "\\$&");
}

/**
 * Builds the `WIFI:` text that phone cameras read as "join this network".
 *
 * @param fields - The Wi-Fi fields: network name, password, security type and whether the network is hidden.
 * @returns For example `WIFI:T:WPA;S:Cafe;P:secret123;;`.
 * @throws PayloadError when the network name or the password is missing or not valid for the security type.
 */
export function wifiPayload(fields: Pick<PayloadFields, "ssid" | "password" | "security" | "hidden">): string {
    const { ssid, password, security, hidden } = fields;
    if (ssid === "") throw new PayloadError("EMPTY", "No network name");
    if (byteLength(ssid) > MAX_SSID_BYTES) throw new PayloadError("SSID_TOO_LONG", "The network name is too long");

    if (security !== "nopass") {
        if (password === "") throw new PayloadError("PASSWORD_REQUIRED", "No password");
        const bytes = byteLength(password);
        const hexKey = /^[0-9a-f]{64}$/i.test(password);
        if (security === "WPA" && !hexKey && (bytes < MIN_WPA_PASSWORD_BYTES || bytes > MAX_WPA_PASSWORD_BYTES)) {
            throw new PayloadError("PASSWORD_LENGTH", "A WPA password has 8 to 63 characters");
        }
    }

    let text = `WIFI:T:${security};S:${escapeWifiValue(ssid)};`;
    if (security !== "nopass") text += `P:${escapeWifiValue(password)};`;
    if (hidden) text += "H:true;";
    return `${text};`;
}

/**
 * Builds the text to encode for the selected kind of content.
 *
 * @param kind - Which tab the user is on.
 * @param fields - Everything the user typed.
 * @returns The text of the QR code.
 * @throws PayloadError when the fields for that kind are empty or not valid.
 */
export function buildPayload(kind: PayloadKind, fields: PayloadFields): string {
    switch (kind) {
        case "link":
            return normalizeUrl(fields.link);
        case "text":
            if (fields.text.trim() === "") throw new PayloadError("EMPTY", "No text");
            return fields.text;
        case "wifi":
            return wifiPayload(fields);
    }
}
