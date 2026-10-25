# QRCoder – QR Code Generator

A Chrome (Manifest V3) extension, written in TypeScript, that creates valid QR codes for links, text
and Wi-Fi networks entirely on your device.

## Features

- **Three kinds of code** – a **Link** (a web address), plain **Text**, or a **Wi-Fi** network that
  phones join when they scan it.
- **Valid by construction** – the encoder follows ISO/IEC 18004 and is written from scratch with no
  runtime dependencies: all 40 versions, all four error correction levels, numeric, alphanumeric and
  byte modes, Reed–Solomon error correction, and mask selection by the standard's penalty rules. See
  [How the codes are verified](#how-the-codes-are-verified).
- **Live preview** – the code updates as you type. The popup shows the version and size, and says why
  there is no code when the input is empty, invalid or too long.
- **Copy or save** – copy the image to the clipboard, or save it as a PNG (a whole number of pixels per
  module, up to 2048 px) or as a scalable SVG.
- **Error correction** – Low (7%), Medium (15%), Quartile (25%) or High (30%) of the code can be damaged
  and still scan.
- **Use current page** – fills the link field with the address of the tab you opened the popup on.
- **Remembers what you typed** (optional, on by default) – kept in browser memory only, so the popup
  does not lose your work when it closes. See [Privacy](#privacy).
- **Roomy popup** that uses the full 640 × 400 px an extension popup can have: the code on the left, the
  input and options on the right, with no scrolling in any language.
- **Localized** in English (US), Brazilian Portuguese, Spanish, French, Italian, German, Russian and
  Polish. The extension follows the browser's UI language automatically; any other language falls back
  to English. See [Localization](#localization).
- **Light / dark theme** (the QR code itself is always black on white, because scanners need that
  contrast), keyboard accessible, no network access, no analytics.
- Open the popup with `Ctrl+Shift+E` (`Command+Shift+E` on macOS); rebind it at
  `chrome://extensions/shortcuts`.

## Install (from source)

Requires Node.js 20.12 or newer.

```bash
npm install
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and select the
`dist/` folder.

## Development

| Command             | Purpose                                                        |
| ------------------- | -------------------------------------------------------------- |
| `npm run build`     | Production build into `dist/`: JS, HTML, CSS and JSON minified |
| `npm run package`   | Build, verify and zip into `release/qrcoder-<version>.zip`     |
| `npm run watch`     | Rebuild on change (unminified, inline source maps)             |
| `npm run typecheck` | Run `tsc --noEmit` in strict mode                              |
| `npm test`          | Run the unit tests (Vitest)                                    |
| `npm run icons`     | Regenerate `public/icons/*.png` (dependency-free generator)    |
| `npm run check`     | Typecheck, test and build                                      |

After a rebuild, press the reload button on the extension's card in `chrome://extensions`.

### Project layout

```
public/                 Static files copied to dist/ (manifest, HTML, CSS, icons)
public/_locales/        Translations: en_US (default), pt_BR, es, fr, it, de, ru and pl
scripts/                Build tooling: build, package, minify, zip and icon generator
src/core/               Pure, DOM-free logic: the QR encoder and the content builders
src/shared/             Settings, in-memory draft, canvas painter, i18n helper
src/popup/              Popup UI
tests/                  Vitest unit tests for core/, shared/, locales, manifest and build tooling
docs/                   Privacy policy and Chrome Web Store answers
```

`src/core/` is split by responsibility:

| File              | Responsibility                                                                         |
| ----------------- | -------------------------------------------------------------------------------------- |
| `tables.ts`       | Version sizes, alignment pattern positions, capacities and error correction block tables |
| `reed-solomon.ts` | Arithmetic in GF(256) and the error correction codewords                               |
| `encoder.ts`      | Mode selection, data codewords, interleaving, module placement, masking                |
| `payload.ts`      | Turns a link, text or Wi-Fi details into the text the code carries                     |
| `svg.ts`          | Renders a code as a standalone SVG document                                            |

## Design notes

### How the codes are verified

A QR code that looks right but does not scan is the failure that matters here, so the encoder is checked
against things it shares no code with:

- **Worked examples from the standard.** The data codewords and error correction codewords of the
  `01234567` and `HELLO WORLD` examples, the format and version information bit strings, the capacity
  tables, and the alignment pattern positions are asserted verbatim.
- **An independent decoder.** Codes are rasterised and read back with [jsQR](https://github.com/cozmo/jsQR)
  for every data mask at every level, for numeric, alphanumeric and UTF-8 text, and for **every one of
  the 160 version and level combinations**, once exactly full and once just above the capacity of the
  version below.
- **An independent generator.** For all 160 combinations the symbol is compared module by module with the
  one made by [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator). The two may pick
  different masks (both are valid), so a symbol agrees when one of the eight masks reproduces it. That
  checks the block tables, interleaving, placement and format and version bits end to end.
- **The mask penalty.** The scoring is compared with a second implementation written straight from the
  standard's wording.

Both libraries are `devDependencies` used only by the tests; nothing from them is bundled. jsQR cannot
read version 23 at level L, not even from the other generator's symbol, so that single combination is
covered by the generator comparison instead.

This is software verification. The tests do not scan with physical phone cameras.

### What the encoder does not do

- **No Kanji mode and no mixed-mode segments.** A text is encoded in one mode: numeric if it is all
  digits, alphanumeric if it uses only the 45 characters `0-9 A-Z space $ % * + - . / :`, otherwise
  bytes. Mixing modes can make some codes a version smaller; it never changes whether they scan.
- **UTF-8 without an ECI header.** Non-ASCII text is written as UTF-8 bytes with no Extended Channel
  Interpretation segment. Modern scanners read it as UTF-8; a very old reader that assumes ISO-8859-1
  would show accented text wrongly.
- **No Micro QR, no custom colours, no logos.** The code is black on white with a four-module quiet
  zone. Altering contrast or covering modules is the most common way to make a code unreadable.
- **The error correction level is yours.** The encoder picks the smallest version that fits at the level
  you chose; it does not raise the level to fill a version.

### Link normalization

An address without a scheme gets `https://`. Only `http` and `https` are accepted. Anything else with a
scheme (`javascript:`, `data:`, `mailto:`, `ftp:`...) is rejected instead of being turned into a
different address, because a code that opens a script or the wrong place is worse than no code. The
address is written the way the browser would send it (internationalized domain names become Punycode,
spaces become `%20`). For other kinds of content, use the **Text** tab.

### Wi-Fi format

The Wi-Fi tab produces the `WIFI:` text that Android and iOS cameras read:
`WIFI:T:WPA;S:<name>;P:<password>;H:true;;`.

- The name and password have `\`, `;`, `,`, `:` and `"` escaped with a backslash.
- The security type is `WPA` (covers WPA2 and WPA3 networks), `WEP` or `nopass` for an open network, which
  leaves the password out.
- The name is limited to 32 bytes and a WPA password to 8–63 bytes (or a 64-digit hexadecimal key), the
  limits of the Wi-Fi standard, counted in UTF-8 bytes.
- Values are escaped but **not** wrapped in quotes. Some generators quote a name or password that looks
  hexadecimal, and scanners differ in whether they strip those quotes again. A numeric password such as
  `12345678` is the common case, so the plain form is used.
- A hidden network adds `H:true;`.

### Rendering

The preview uses a whole number of CSS pixels per module and the screen's pixel density, so edges stay
sharp. Saved PNGs also use a whole number of pixels per module, the largest that fits the size you chose,
so a "1024 px" image of a 37-module code is 999 px wide. Modules are laid out on rounded pixel boundaries
when the size does not divide evenly, so neighbours always touch and no hairline gaps appear.

### Permissions

| Permission  | Why                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------- |
| `storage`   | Remember your options, and hold what you typed in memory                                    |
| `activeTab` | Read the address of the current tab for **Use current page**, when you open the popup on it |

No host permissions, optional permissions, content scripts or background worker. Copying the image to the
clipboard and saving files happen in response to your click and need no permission.

### Privacy

What you type is turned into a code in memory, shown in the popup, and discarded when the popup closes,
unless **Remember what I typed** is on (the default). Then the fields, **a Wi-Fi password included**, are
kept unencrypted in `chrome.storage.session`: browser memory only, never written to disk, erased when
Chrome closes, and deleted at once when the setting is turned off or **Clear all fields** is pressed.
Only your option choices (last tab, error correction level, image size and that setting) are persisted
through `chrome.storage.sync`, so they follow your Chrome profile. The extension makes no network
requests. Note that anyone who can see a Wi-Fi QR code can read its password.

### Localization

The extension uses Chrome's built-in `chrome.i18n` system, so the language always follows the
browser's UI language and needs no setting. Chrome picks the best match: an exact locale such as
`pt_BR`, then the base language such as `es`, then the default locale `en_US`.

- **Messages** live in `public/_locales/<locale>/messages.json`. The manifest (name, description,
  toolbar tooltip, shortcut description) uses `__MSG_<key>__` references.
- **Popup text** is localized at startup by `applyTranslations` in `src/shared/i18n.ts`. The HTML keeps
  its English text as a fallback and marks translatable elements with `data-i18n="key"`,
  `data-i18n-title`, `data-i18n-aria-label` or `data-i18n-placeholder`. Messages built in code use
  `t("key", substitutions)`. Message keys are type-checked against `en_US/messages.json`.
- **The core stays language-neutral:** the encoder and the content builders report error _codes_; the
  popup maps them to localized text.
- **Adding a language:** copy `public/_locales/en_US` to a new folder named after the locale (for
  example `nl` or `ja`), translate every `message`, and keep the `placeholders` blocks unchanged. Then
  add the folder name to `EXPECTED_LOCALES` in `tests/i18n.test.ts`. The tests check that every locale
  has the same keys and placeholders as `en_US`, that no message is unused, and that the extension
  description stays within the Web Store limit of 132 characters. Keep the two save buttons short: each
  is about 111 px wide.
- **Testing a language:** start Chrome with `--lang=pt-BR` (or change the language in
  `chrome://settings/languages` and restart Chrome), then reload the extension.

### Code documentation

Every function is documented with [TSDoc](https://tsdoc.org): a one-line summary, then
`@param name - description`, `@returns` and `@throws` where they apply. Types are not repeated in the
tags because TypeScript already provides them.

### Build and packaging

`npm run build` always produces the production build that is shipped. Only `npm run watch` skips
minification, so that errors point at readable code.

| File type                  | How it is minified                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| TypeScript → JavaScript    | esbuild: bundled, minified, no source maps, license comments removed                                                     |
| `popup.css`                | esbuild's CSS minifier                                                                                                   |
| `popup.html`               | `scripts/minify.mjs`: comments removed and whitespace collapsed; quoted attributes and `<script>`/`<textarea>` untouched |
| `manifest.json`            | Compact JSON, with the version taken from `package.json`                                                                 |
| `_locales/*/messages.json` | Compact JSON, without the translator-only `description` and `example` notes                                              |
| Icons                      | Copied as they are                                                                                                       |

`npm run package` then verifies the build and writes the Web Store upload to
`release/qrcoder-<version>.zip` (reproducible: the same sources give the same bytes). It stops with an
error if the manifest references a missing file, if source maps or other development files slipped in,
if an HTML page has an inline script, or if the bundled JavaScript contains `fetch`, `XMLHttpRequest`,
`WebSocket`, `eval`, `new Function` or an `http(s)://` address. The SVG namespace
(`http://www.w3.org/2000/svg`), which every SVG file must declare, and a bare `https://` prefix are the
only exceptions; the extension never connects to either.

### Security

- **No network, by construction.** The content security policy blocks every request
  (`connect-src 'none'`), plugins, base-URL changes and form posts, and allows only scripts packaged
  with the extension. The package check above rejects network and `eval` code.
- **No site access.** The manifest declares no host permissions, content scripts or web-accessible
  resources. `activeTab` gives access to one tab only when you open the popup on it, and the code reads
  only that tab's address, only when you press **Use current page**.
- **Safe DOM updates.** The code never uses `innerHTML`; text goes in with `textContent`.
- **Safe links.** Only `http` and `https` addresses become link codes, so a code cannot be made to run
  script by accident.
- **Memory-only input.** What you type lives in `chrome.storage.session`, never on disk.
- **Guard tests.** `tests/manifest.test.ts` fails if a permission is added without a matching
  justification in `docs/chrome-web-store.md`, or if the manifest gains host access, a background worker
  or a weaker policy.
- **Dependencies.** The extension ships no runtime dependencies: everything bundled into the package is
  this repository's own code. The two `devDependencies` used to verify the codes (`jsqr` and
  `qrcode-generator`) are never bundled.

### Publishing

- [docs/chrome-web-store.md](docs/chrome-web-store.md): answers for the Chrome Web Store _Privacy
  practices_ tab (single purpose and permission justifications).
- [docs/privacy-policy.md](docs/privacy-policy.md): the privacy policy. The store needs it at a public
  URL. Update it before releasing any change to what the extension stores or transmits.

"QR Code" is a registered trademark of DENSO WAVE INCORPORATED.

## Limitations

- One mode per code and no ECI header; see [What the encoder does not do](#what-the-encoder-does-not-do).
- A Wi-Fi code holds the network password in the clear. Anyone who can see the code can read it.
- Only `http` and `https` links. Use the Text tab for `mailto:`, `tel:` and other schemes; whether a
  scanner acts on them is up to the scanner.
- WEP passwords are not length-checked, and enterprise (EAP) networks are not supported.
- Verified with software decoders, not with every phone camera. If a code made for a screen scans badly,
  raise the error correction level or save a larger image.
