/*
    QRCoder Chrome Extension
    Copyright (C) 2026 Miguel Nischor

    File: tests/payload.test.ts
    Description: Unit tests for turning links, text and Wi-Fi details into QR code content.
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
import { encode } from "../src/core/encoder";
import {
    DEFAULT_FIELDS,
    PayloadError,
    buildPayload,
    escapeWifiValue,
    normalizeUrl,
    wifiPayload,
    type PayloadErrorCode,
    type PayloadFields,
} from "../src/core/payload";
import { scan } from "./qr-image";

/**
 * Builds payload fields from the empty defaults.
 *
 * @param overrides - Fields to change.
 * @returns Complete fields.
 */
const fields = (overrides: Partial<PayloadFields> = {}): PayloadFields => ({ ...DEFAULT_FIELDS, ...overrides });

/**
 * Runs a function that must fail with a payload error.
 *
 * @param action - Function expected to throw.
 * @returns The code of the error it threw.
 */
function errorCode(action: () => unknown): PayloadErrorCode {
    try {
        action();
    } catch (error) {
        expect(error).toBeInstanceOf(PayloadError);
        return (error as PayloadError).code;
    }
    throw new Error("Expected the call to throw");
}

describe("normalizeUrl", () => {
    it("adds https:// to addresses without a scheme", () => {
        expect(normalizeUrl("example.com")).toBe("https://example.com/");
        expect(normalizeUrl("example.com/menu?table=4")).toBe("https://example.com/menu?table=4");
        expect(normalizeUrl("www.example.com:8080/a")).toBe("https://www.example.com:8080/a");
        expect(normalizeUrl("localhost:3000")).toBe("https://localhost:3000/");
        expect(normalizeUrl("192.168.0.1/admin")).toBe("https://192.168.0.1/admin");
    });

    it("keeps http and https addresses, in any letter case", () => {
        expect(normalizeUrl("http://example.com/a")).toBe("http://example.com/a");
        expect(normalizeUrl("HTTPS://Example.COM/A")).toBe("https://example.com/A");
    });

    it("trims the text around the address", () => {
        expect(normalizeUrl("  https://example.com  \n")).toBe("https://example.com/");
    });

    it("writes non-ASCII addresses the way browsers send them", () => {
        expect(normalizeUrl("münchen.de/straße")).toBe("https://xn--mnchen-3ya.de/stra%C3%9Fe");
        expect(normalizeUrl("example.com/a b")).toBe("https://example.com/a%20b");
    });

    it("reports nothing typed as EMPTY", () => {
        expect(errorCode(() => normalizeUrl(""))).toBe("EMPTY");
        expect(errorCode(() => normalizeUrl("   \n "))).toBe("EMPTY");
    });

    it("rejects other schemes instead of turning them into a different address", () => {
        for (const input of [
            "javascript:alert(1)",
            "JAVASCRIPT:alert(1)",
            "data:text/html,<b>x</b>",
            "mailto:me@example.com",
            "tel:+5511999999999",
            "ftp://example.com",
            "file:///etc/passwd",
            "http:/example.com",
            "vbscript:msgbox(1)",
        ]) {
            expect(errorCode(() => normalizeUrl(input)), input).toBe("INVALID_URL");
        }
    });

    it("rejects text that is not an address", () => {
        for (const input of ["hello world", "exa mple.com", "http://", "https://", "http://exa mple.com", "://x"]) {
            expect(errorCode(() => normalizeUrl(input)), input).toBe("INVALID_URL");
        }
    });
});

describe("escapeWifiValue", () => {
    it("puts a backslash before backslash, semicolon, comma, colon and double quote", () => {
        expect(escapeWifiValue('a\\b;c,d:e"f')).toBe('a\\\\b\\;c\\,d\\:e\\"f');
    });

    it("leaves everything else alone", () => {
        expect(escapeWifiValue("Café 5G - guest_net.1")).toBe("Café 5G - guest_net.1");
    });
});

describe("wifiPayload", () => {
    const wifi = (overrides: Partial<PayloadFields>) => wifiPayload(fields({ ssid: "Home", ...overrides }));

    it("builds the format phone cameras read", () => {
        expect(wifi({ password: "secret123" })).toBe("WIFI:T:WPA;S:Home;P:secret123;;");
        expect(wifi({ security: "WEP", password: "abcde" })).toBe("WIFI:T:WEP;S:Home;P:abcde;;");
    });

    it("marks hidden networks", () => {
        expect(wifi({ password: "secret123", hidden: true })).toBe("WIFI:T:WPA;S:Home;P:secret123;H:true;;");
    });

    it("leaves the password out of an open network, even if one was typed earlier", () => {
        expect(wifi({ security: "nopass", password: "leftover" })).toBe("WIFI:T:nopass;S:Home;;");
        expect(wifi({ security: "nopass", hidden: true })).toBe("WIFI:T:nopass;S:Home;H:true;;");
    });

    it("escapes special characters in the name and the password", () => {
        expect(wifi({ ssid: "My;Net:5,0", password: 'p"a\\ss;word' })).toBe(
            'WIFI:T:WPA;S:My\\;Net\\:5\\,0;P:p\\"a\\\\ss\\;word;;'
        );
    });

    it("keeps spaces in the name and the password", () => {
        expect(wifi({ ssid: " Cafe ", password: "correct horse" })).toBe("WIFI:T:WPA;S: Cafe ;P:correct horse;;");
    });

    it("requires a network name", () => {
        expect(errorCode(() => wifiPayload(fields({ password: "secret123" })))).toBe("EMPTY");
    });

    it("limits the name to 32 bytes, not 32 characters", () => {
        expect(wifi({ ssid: "a".repeat(32), password: "secret123" })).toContain(`S:${"a".repeat(32)};`);
        expect(errorCode(() => wifi({ ssid: "a".repeat(33), password: "secret123" }))).toBe("SSID_TOO_LONG");
        expect(wifi({ ssid: "é".repeat(16), password: "secret123" })).toContain("S:");
        expect(errorCode(() => wifi({ ssid: "é".repeat(17), password: "secret123" }))).toBe("SSID_TOO_LONG");
    });

    it("requires a password unless the network is open", () => {
        expect(errorCode(() => wifi({ password: "" }))).toBe("PASSWORD_REQUIRED");
        expect(errorCode(() => wifi({ security: "WEP", password: "" }))).toBe("PASSWORD_REQUIRED");
        expect(wifi({ security: "nopass", password: "" })).toBe("WIFI:T:nopass;S:Home;;");
    });

    it("accepts a WPA password of 8 to 63 bytes, or a 64-digit hexadecimal key", () => {
        expect(wifi({ password: "12345678" })).toContain("P:12345678;");
        expect(wifi({ password: "a".repeat(63) })).toContain(`P:${"a".repeat(63)};`);
        expect(wifi({ password: "AbCdEf0123456789".repeat(4) })).toContain("P:AbCdEf0123456789");
        expect(errorCode(() => wifi({ password: "1234567" }))).toBe("PASSWORD_LENGTH");
        expect(errorCode(() => wifi({ password: "g".repeat(64) }))).toBe("PASSWORD_LENGTH");
        expect(errorCode(() => wifi({ password: "é".repeat(32) }))).toBe("PASSWORD_LENGTH");
    });
});

describe("buildPayload", () => {
    it("builds each kind from its own fields only", () => {
        const all = fields({ link: "example.com", text: "hello", ssid: "Home", password: "secret123" });
        expect(buildPayload("link", all)).toBe("https://example.com/");
        expect(buildPayload("text", all)).toBe("hello");
        expect(buildPayload("wifi", all)).toBe("WIFI:T:WPA;S:Home;P:secret123;;");
    });

    it("keeps text exactly as typed, line breaks and surrounding spaces included", () => {
        expect(buildPayload("text", fields({ text: "  line one\nline two \n" }))).toBe("  line one\nline two \n");
    });

    it("treats text that is only whitespace as empty", () => {
        expect(errorCode(() => buildPayload("text", fields({ text: " \n\t " })))).toBe("EMPTY");
        expect(errorCode(() => buildPayload("link", fields()))).toBe("EMPTY");
        expect(errorCode(() => buildPayload("wifi", fields()))).toBe("EMPTY");
    });
});

describe("scanning what was built", () => {
    // The point of the Wi-Fi format is what a phone does with it, so check the text survives a real scan.
    it.each([
        ["link", fields({ link: "example.com/menu" })],
        ["text", fields({ text: "Olá, mundo! 日本語 😀\nsegunda linha" })],
        ["wifi", fields({ ssid: "Café; 5G", password: 'p"a\\ss;word:1,2', hidden: true })],
        ["wifi", fields({ ssid: "Open", security: "nopass" })],
    ] as const)("a %s code reads back as the payload", (kind, input) => {
        const payload = buildPayload(kind, input);
        for (const level of ["L", "M", "Q", "H"] as const) {
            expect(scan(encode(payload, level))?.text, level).toBe(payload);
        }
    });
});
