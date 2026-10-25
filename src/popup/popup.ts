/*
    QRCoder Chrome Extension
    Copyright (C) 2026 Miguel Nischor

    File: src/popup/popup.ts
    Description: Popup user interface for the QRCoder Chrome extension.
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
import { QrError, encode, maxByteCapacity, type QrCode } from "../core/encoder";
import {
    DEFAULT_FIELDS,
    MAX_SSID_BYTES,
    MAX_WPA_PASSWORD_BYTES,
    MIN_WPA_PASSWORD_BYTES,
    PAYLOAD_KINDS,
    PayloadError,
    buildPayload,
    type PayloadFields,
    type PayloadKind,
    type WifiSecurity,
} from "../core/payload";
import { QUIET_ZONE, toSvg } from "../core/svg";
import { paintQr, renderPng } from "../shared/canvas";
import { clearDraft, loadDraft, saveDraft } from "../shared/draft";
import { applyTranslations, t, uiLanguage } from "../shared/i18n";
import { EXPORT_SIZES, loadSettings, sanitizeSettings, saveSettings, type Settings } from "../shared/settings";

/** Delay before persisting, so typing does not hammer the storage areas. */
const SAVE_DEBOUNCE_MS = 400;

/** Largest side of the preview, in CSS pixels. The preview uses a whole number of pixels per module. */
const PREVIEW_PIXELS = 204;

/**
 * Finds an element by id.
 *
 * @typeParam T - Expected element type.
 * @param id - Value of the element's `id` attribute.
 * @returns The element.
 * @throws Error when the page has no element with that id.
 */
function el<T extends HTMLElement>(id: string): T {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Missing element #${id}`);
    return node as T;
}

const ui = {
    mainView: el<HTMLElement>("main-view"),
    settingsView: el<HTMLElement>("settings-view"),
    settingsOpen: el<HTMLButtonElement>("settings-open"),
    settingsBack: el<HTMLButtonElement>("settings-back"),
    settingsStatus: el<HTMLElement>("settings-status"),
    remember: el<HTMLInputElement>("remember"),
    clearFields: el<HTMLButtonElement>("clear-fields"),
    canvas: el<HTMLCanvasElement>("qr"),
    previewEmpty: el<HTMLElement>("preview-empty"),
    previewError: el<HTMLElement>("preview-error"),
    info: el<HTMLElement>("qr-info"),
    copy: el<HTMLButtonElement>("copy"),
    savePng: el<HTMLButtonElement>("save-png"),
    saveSvg: el<HTMLButtonElement>("save-svg"),
    status: el<HTMLElement>("status"),
    link: el<HTMLInputElement>("link"),
    linkUsePage: el<HTMLButtonElement>("link-use-page"),
    text: el<HTMLTextAreaElement>("text"),
    ssid: el<HTMLInputElement>("ssid"),
    password: el<HTMLInputElement>("password"),
    passwordToggle: el<HTMLButtonElement>("password-toggle"),
    security: el<HTMLSelectElement>("security"),
    hidden: el<HTMLInputElement>("hidden"),
    errorCorrection: el<HTMLSelectElement>("error-correction"),
    exportSize: el<HTMLSelectElement>("export-size"),
};

const tabs = new Map<PayloadKind, { tab: HTMLButtonElement; panel: HTMLElement }>(
    PAYLOAD_KINDS.map((kind) => [kind, { tab: el<HTMLButtonElement>(`tab-${kind}`), panel: el(`panel-${kind}`) }])
);

let settings: Settings;
let fields: PayloadFields = { ...DEFAULT_FIELDS };
/** The code on screen; `null` while the fields are empty or invalid. */
let current: QrCode | null = null;
let settingsTimer: number | undefined;
let draftTimer: number | undefined;
let statusTimer: number | undefined;

/**
 * Shows a message on a status line.
 *
 * @param text - Localized message; an empty string clears the line.
 * @param isError - Whether to style the message as an error.
 * @param autoClearMs - Milliseconds after which the message disappears; 0 keeps it.
 * @param target - The status line to use.
 */
function setStatus(text: string, isError = false, autoClearMs = 0, target: HTMLElement = ui.status): void {
    window.clearTimeout(statusTimer);
    target.textContent = text;
    target.classList.toggle("error", isError);
    if (autoClearMs > 0) {
        statusTimer = window.setTimeout(() => {
            target.textContent = "";
        }, autoClearMs);
    }
}

/**
 * Turns a failure into a localized message.
 *
 * @param error - Value thrown while building or encoding the content.
 * @returns A message for the user in the browser's UI language.
 */
function describeError(error: unknown): string {
    if (error instanceof QrError) return t("errorTooLong", String(maxByteCapacity(settings.errorCorrection)));
    if (!(error instanceof PayloadError)) return t("errorGeneric");
    switch (error.code) {
        case "INVALID_URL":
            return t("errorInvalidUrl");
        case "SSID_TOO_LONG":
            return t("errorSsidTooLong", String(MAX_SSID_BYTES));
        case "PASSWORD_REQUIRED":
            return t("errorPasswordRequired");
        case "PASSWORD_LENGTH":
            return t("errorPasswordLength", [String(MIN_WPA_PASSWORD_BYTES), String(MAX_WPA_PASSWORD_BYTES)]);
        case "EMPTY":
            return "";
    }
}

/**
 * Draws the code on the preview canvas, using a whole number of CSS pixels per module so edges stay sharp, and
 * the screen's pixel density so they stay sharp on high-resolution displays too.
 *
 * @param qr - The code to show.
 */
function paintPreview(qr: QrCode): void {
    const modules = qr.size + QUIET_ZONE * 2;
    const cssSize = modules * Math.max(1, Math.floor(PREVIEW_PIXELS / modules));
    ui.canvas.style.width = ui.canvas.style.height = `${cssSize}px`;
    ui.canvas.width = ui.canvas.height = Math.round(cssSize * (window.devicePixelRatio || 1));
    const context = ui.canvas.getContext("2d");
    if (context) paintQr(context, qr, ui.canvas.width);
}

/** Rebuilds the code from the fields and the options, and shows it, or explains why there is none. */
function update(): void {
    let message = "";
    try {
        current = encode(buildPayload(settings.kind, fields), settings.errorCorrection);
    } catch (error) {
        current = null;
        message = describeError(error);
    }

    ui.canvas.hidden = current === null;
    ui.previewEmpty.hidden = current !== null || message !== "";
    ui.previewError.hidden = message === "";
    ui.previewError.textContent = message;
    ui.info.textContent = current ? t("qrInfo", [String(current.version), String(current.size)]) : "";
    for (const button of [ui.copy, ui.savePng, ui.saveSvg]) button.disabled = current === null;
    if (current) paintPreview(current);
}

/** Persists the settings shortly after the last change. */
function scheduleSettingsSave(): void {
    window.clearTimeout(settingsTimer);
    settingsTimer = window.setTimeout(() => {
        saveSettings(settings).catch(() => setStatus(t("statusSaveFailed"), true));
    }, SAVE_DEBOUNCE_MS);
}

/** Keeps what was typed in memory shortly after the last keystroke, when the user allows it. */
function scheduleDraftSave(): void {
    if (!settings.rememberInputs) return;
    window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => void saveDraft(fields).catch(() => undefined), SAVE_DEBOUNCE_MS);
}

/** Pushes the fields into the form controls. */
function renderFields(): void {
    ui.link.value = fields.link;
    ui.text.value = fields.text;
    ui.ssid.value = fields.ssid;
    ui.password.value = fields.password;
    ui.security.value = fields.security;
    ui.hidden.checked = fields.hidden;
    ui.password.disabled = fields.security === "nopass";
}

/** Reads the form controls back into the fields and refreshes the code. */
function onFieldsChanged(): void {
    fields = {
        link: ui.link.value,
        text: ui.text.value,
        ssid: ui.ssid.value,
        password: ui.password.value,
        security: ui.security.value as WifiSecurity,
        hidden: ui.hidden.checked,
    };
    ui.password.disabled = fields.security === "nopass";
    setStatus("");
    update();
    scheduleDraftSave();
}

/**
 * Shows the tab and panel of a kind of content, and the code for it.
 *
 * @param kind - The tab to show.
 * @param focusTab - Move the keyboard focus to the tab, as arrow-key navigation does.
 */
function showKind(kind: PayloadKind, focusTab = false): void {
    settings = { ...settings, kind };
    for (const [id, { tab, panel }] of tabs) {
        const selected = id === kind;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
        panel.hidden = !selected;
    }
    if (focusTab) tabs.get(kind)?.tab.focus();
    setStatus("");
    update();
}

/**
 * Switches to another kind of content and remembers the choice.
 *
 * @param kind - The tab to show.
 * @param focusTab - Move the keyboard focus to the tab, as arrow-key navigation does.
 */
function selectKind(kind: PayloadKind, focusTab = false): void {
    showKind(kind, focusTab);
    scheduleSettingsSave();
}

/**
 * Handles the arrow, Home and End keys on the tab list.
 *
 * @param event - The key press.
 */
function onTabKey(event: KeyboardEvent): void {
    const index = PAYLOAD_KINDS.indexOf(settings.kind);
    const moves: Record<string, number> = {
        ArrowRight: (index + 1) % PAYLOAD_KINDS.length,
        ArrowLeft: (index + PAYLOAD_KINDS.length - 1) % PAYLOAD_KINDS.length,
        Home: 0,
        End: PAYLOAD_KINDS.length - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    selectKind(PAYLOAD_KINDS[target]!, true);
}

/** Fills the link field with the address of the page the popup was opened on. */
async function useCurrentPage(): Promise<void> {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.url || !/^https?:\/\//i.test(tab.url)) throw new Error("No web page");
        ui.link.value = tab.url;
        onFieldsChanged();
    } catch {
        setStatus(t("statusUsePageFailed"), true, 4000);
    }
}

/**
 * Starts a download of a generated file.
 *
 * @param blob - File contents.
 * @param extension - File extension without the dot.
 */
function download(blob: Blob, extension: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `qrcode-${settings.kind}.${extension}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(t("statusSaved"), false, 3000);
}

/** Saves the code as a PNG image of the chosen size. */
async function savePng(): Promise<void> {
    if (!current) return;
    try {
        download(await renderPng(current, settings.exportSize), "png");
    } catch {
        setStatus(t("errorGeneric"), true);
    }
}

/** Saves the code as a scalable SVG image. */
function saveSvg(): void {
    if (current) download(new Blob([toSvg(current)], { type: "image/svg+xml" }), "svg");
}

/** Copies the code to the clipboard as a PNG image of the chosen size. */
async function copyImage(): Promise<void> {
    if (!current) return;
    try {
        // The image is passed as a promise so the write starts inside the click, as Chrome requires.
        await navigator.clipboard.write([new ClipboardItem({ "image/png": renderPng(current, settings.exportSize) })]);
        setStatus(t("statusCopied"), false, 3000);
    } catch {
        setStatus(t("statusCopyFailed"), true);
    }
}

/**
 * Shows the settings or the generator.
 *
 * @param visible - `true` for the settings, `false` to return to the generator.
 */
function showSettings(visible: boolean): void {
    ui.mainView.hidden = visible;
    ui.settingsView.hidden = !visible;
    setStatus("", false, 0, ui.settingsStatus);
}

/** Applies the "remember" checkbox: starts keeping what was typed, or deletes it. */
async function onRememberChanged(): Promise<void> {
    settings = sanitizeSettings({ ...settings, rememberInputs: ui.remember.checked });
    scheduleSettingsSave();
    window.clearTimeout(draftTimer);
    try {
        if (settings.rememberInputs) await saveDraft(fields);
        else await clearDraft();
    } catch {
        setStatus(t("statusSaveFailed"), true, 0, ui.settingsStatus);
    }
}

/** Empties every field and deletes the remembered copy. */
async function onClearFields(): Promise<void> {
    window.clearTimeout(draftTimer);
    fields = { ...DEFAULT_FIELDS };
    renderFields();
    update();
    await clearDraft().catch(() => undefined);
    setStatus(t("statusCleared"), false, 3000, ui.settingsStatus);
}

/** Shows or hides the Wi-Fi password. */
function togglePassword(): void {
    const reveal = ui.password.type === "password";
    ui.password.type = reveal ? "text" : "password";
    ui.passwordToggle.textContent = t(reveal ? "hidePassword" : "showPassword");
    ui.passwordToggle.setAttribute("aria-pressed", String(reveal));
}

/** Attaches every event listener of the popup. */
function bindEvents(): void {
    for (const [kind, { tab }] of tabs) {
        tab.addEventListener("click", () => selectKind(kind));
        tab.addEventListener("keydown", onTabKey);
    }

    for (const control of [ui.link, ui.text, ui.ssid, ui.password]) control.addEventListener("input", onFieldsChanged);
    ui.security.addEventListener("change", onFieldsChanged);
    ui.hidden.addEventListener("change", onFieldsChanged);
    ui.linkUsePage.addEventListener("click", () => void useCurrentPage());
    ui.passwordToggle.addEventListener("click", togglePassword);

    ui.errorCorrection.addEventListener("change", () => {
        settings = sanitizeSettings({ ...settings, errorCorrection: ui.errorCorrection.value });
        update();
        scheduleSettingsSave();
    });
    ui.exportSize.addEventListener("change", () => {
        settings = sanitizeSettings({ ...settings, exportSize: Number(ui.exportSize.value) });
        scheduleSettingsSave();
    });

    ui.copy.addEventListener("click", () => void copyImage());
    ui.savePng.addEventListener("click", () => void savePng());
    ui.saveSvg.addEventListener("click", saveSvg);

    ui.settingsOpen.addEventListener("click", () => showSettings(true));
    ui.settingsBack.addEventListener("click", () => showSettings(false));
    ui.remember.addEventListener("change", () => void onRememberChanged());
    ui.clearFields.addEventListener("click", () => void onClearFields());
}

/** Localizes the page, loads the settings and what was typed, and shows the first code. */
async function init(): Promise<void> {
    document.documentElement.lang = uiLanguage();
    applyTranslations();

    ui.exportSize.replaceChildren(
        ...EXPORT_SIZES.map((size) => {
            const option = document.createElement("option");
            option.value = String(size);
            option.textContent = t("exportSizeOption", String(size));
            return option;
        })
    );

    settings = await loadSettings();
    if (settings.rememberInputs) fields = await loadDraft();
    ui.errorCorrection.value = settings.errorCorrection;
    ui.exportSize.value = String(settings.exportSize);
    ui.remember.checked = settings.rememberInputs;
    renderFields();
    bindEvents();
    showKind(settings.kind);
    tabs.get(settings.kind)?.panel.querySelector<HTMLElement>("input, textarea")?.focus();
}

void init();
