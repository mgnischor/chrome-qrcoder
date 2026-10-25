# Chrome Web Store: Privacy practices answers

Text to paste into the **Privacy practices** tab of the Chrome Web Store developer dashboard.
Every statement below was checked against the source code (permissions in `public/manifest.json`).
If a feature or permission changes, update the matching answer, because reviewers compare them.
`tests/manifest.test.ts` fails when a permission has no `###` section here.

## Single purpose description

> QRCoder creates QR codes from what the user types: a web address, plain text or the details of a Wi-Fi network. Every feature supports that one purpose: the fields and the live preview, the error correction and image size options, the copy and save buttons for the finished image, the button that fills in the address of the page the user is on, and the optional in-memory storage of what the user typed so it is still there when the popup is reopened. The QR code is generated entirely on the user's device.

## Permission justifications

### storage

> Saves the user's preferences (the tab that was open last, the error correction level, the image size and whether to remember what was typed) in chrome.storage.sync so they persist between sessions. It also uses chrome.storage.session, which is held in memory only and never written to disk, to keep what the user typed (including a Wi-Fi password, if entered) while the browser is open, so it is still there when the popup is reopened. The user can turn that off in the settings, which deletes it immediately. None of this is sent to any server.

### activeTab

> Used only by the "Use current page" button. When the user clicks the toolbar icon or presses the keyboard shortcut, Chrome grants temporary access to the active tab, and the popup reads that one tab's address (a web address starting with http or https) to fill in the link field when the user presses the button. The extension has no host permissions and no content scripts, never reads page content, and sends the address nowhere: it only becomes the text of the QR code the user is making.

## Other fields

| Field                            | Answer                                                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Host permission justification    | Not applicable: the extension requests no host permissions.                                                                                                                                      |
| Are you using remote code?       | No. All JavaScript is packaged in the extension (Manifest V3, `script-src 'self'`). The extension makes no network requests at all (`connect-src 'none'`).                                      |
| Data usage: data types collected | Leave every box unchecked. The extension does not collect user data: nothing is transmitted off the device, and there is no analytics, telemetry or server of the developer.                    |
| Data usage: certifications       | Check all three: data is not sold, not used for unrelated purposes, and not used for creditworthiness or lending.                                                                                |
| Privacy policy URL               | Recommended even though no data is collected, because users type links, text and Wi-Fi passwords into the extension. See `docs/privacy-policy.md`; the store needs it at a public URL.             |

### Notes

- The extension has no background service worker and no content scripts. It requests two permissions,
  `storage` and `activeTab`, and no optional permissions or host permissions.
- The dashboard treats data as "collected" only when it is transmitted off the user's device. QRCoder
  processes what is typed, the generated image and the settings locally, and never transmits them, so
  none of the data-type boxes apply.
- `chrome.storage.sync` is Chrome's own sync of the user's preferences. Preferences contain no typed
  content. What was typed lives only in `chrome.storage.session`, which is memory only.
- The "Copy image" and "Save PNG / Save SVG" buttons write to the clipboard and start a download in
  response to the user's click, which needs no permission.
- Permission justifications are limited to roughly 1,000 characters each; the answers above are well
  under that.
- The store listing description and screenshots should mention the same features (links, text and
  Wi-Fi codes, copy and save as PNG or SVG, the current page button, the optional in-memory storage of
  what was typed) so they match these answers.
- "QR Code" is a registered trademark of DENSO WAVE INCORPORATED. The listing should not suggest that the
  extension is made or endorsed by DENSO WAVE.
