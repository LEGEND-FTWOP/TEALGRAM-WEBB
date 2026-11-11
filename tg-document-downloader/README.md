# TG Documents & PDF Downloader

A separate Chrome / Edge extension for downloading PDFs and document attachments from Telegram Web. You can keep your existing video and photo extension installed.

## Install

1. Extract `tg-document-downloader.zip`.
2. Open `chrome://extensions` in Chrome, or `edge://extensions` in Edge.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the extracted `tg-document-downloader` folder containing `manifest.json`.
5. Open **https://web.telegram.org/k/**, sign in, and refresh the page if it was already open.

## Download a document

1. Open your channel or chat in **Telegram Web K**.
2. Scroll to the PDF or document attachment.
3. Click **Download PDF** or **Download file** below its card.
4. Keep the tab open while Telegram retrieves the file. Use **Cancel** to stop an active download.
5. When the extension says the file was sent to your browser, check the browser's Downloads list. Your normal browser save settings apply.

Original filenames and extensions are preserved, with characters that are invalid in filenames replaced. Existing files are handled by your browser's normal duplicate filename rules. The extension does not overwrite your files.

PDF, Word, Excel, PowerPoint, text, archive, and other document attachments are supported. Photos, video, audio, and stickers remain outside this extension's scope.

## Telegram versions and limits

- **Web K is the recommended and primary supported client.** It exposes the document metadata and its authenticated file loader. The extension can request documents there even when the channel hides its normal saving or forwarding controls, provided Telegram supplies the file to your current signed-in session.
- Other Telegram Web clients, including Web A, work only when the document card exposes an exact, accessible document URL. If the file is unavailable, switch to `https://web.telegram.org/k/`. The extension does not guess which cached file belongs to a document.
- You must already be able to access the chat or channel. This extension does not log in for you or access channels outside your account.
- Maximum supported file size: **512 MiB per document**. Files are assembled in memory, so available browser memory can impose a lower practical limit. One download runs at a time in each Telegram tab.
- Telegram may change its internal file loader or page structure. If buttons disappear or a request fails, refresh Telegram Web K and retry. If Telegram no longer exposes the file, the extension displays an error.
- “Sent to browser” means a browser download was requested. Check the browser's Downloads list to confirm it finished; the extension does not inspect your disk.
- This unpacked extension is for desktop Chrome / Edge version 111 or later. It is not a Telegram mobile app extension.

## Privacy and permissions

The extension runs only on `web.telegram.org`, `webk.telegram.org`, and `webz.telegram.org`. It uses the Telegram page's existing session and document loader. It does not read or store your credentials, send files to an external service, collect analytics, or contact its own servers. No broad host permission, background service worker, or download-history permission is requested.

The page bridge keeps a bounded in-memory cache of document Blob URLs (up to 64 MiB) so an exact URL can still be saved after Telegram releases it. This is cleared when the tab closes or reloads. It never associates an unrelated recent Blob with a selected document.

## Package contents

- `manifest.json`: extension registration and Telegram-only content script matching.
- `content.js` / `style.css`: document detection, buttons, progress, and cancellation.
- `bridge.js`: Telegram Web K file loader integration and exact-URL fallback.
- `transfer.js`: complete-file and ranged-response validation, filenames, and browser saving.
- `popup.html` / `popup.css`: quick usage instructions.

No build step or dependencies are needed to install this folder.

## Verification

The package passed 22 automated transfer/bridge tests and seven Chromium integration checks using simulated Telegram document cards and file-loader responses. These cover byte-for-byte file saving, original filenames, cancellation, dynamically added cards, and incomplete-file errors. The managed browser blocks unpacked extension installation by administrator policy, so browser tests injected the manifest scripts into their corresponding MAIN and isolated worlds. A real download from your signed-in Telegram channel still needs to be verified in your browser; no Telegram account was available in the build environment.
