# TG Documents & PDF Downloader

[**Download the extension ZIP**](https://github.com/LEGEND-FTWOP/TEALGRAM-WEBB/raw/refs/heads/main/tg-document-downloader.zip)

A separate Chrome / Edge extension for PDFs and document attachments on Telegram Web. It preserves original filenames and includes progress, cancellation, and incomplete-file checks. It can run alongside your existing video and photo downloader.

## Install

1. Download and extract `tg-document-downloader.zip`.
2. Open `chrome://extensions` or `edge://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the extracted `tg-document-downloader` folder containing `manifest.json`.
4. Open **https://web.telegram.org/k/** and refresh Telegram if it was already open.
5. Open your channel or chat, then click **Download PDF** or **Download file** below an attachment.

**Telegram Web K is the recommended client.** Other Telegram Web versions need to expose the exact document URL. Files up to **512 MiB** are supported, one at a time in each tab.

The extension uses Telegram's existing signed-in session and file loader. It has no external servers, analytics, background service worker, or download-history permissions.

See [full instructions and limitations](tg-document-downloader/README.md). Automated tests passed, including Chromium checks with simulated Telegram files. A real download from your signed-in channel still needs to be checked in your browser.

Source: [tg-document-downloader/](tg-document-downloader/)
