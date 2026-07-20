# Printer Integration Glossary

## Bluetooth Classic

The older Bluetooth transport used by many inexpensive receipt printers. These printers often expose an RFCOMM Serial Port Profile and are not automatically compatible with Web Bluetooth.

## RFCOMM

A Bluetooth Classic protocol that emulates a serial data stream.

## SPP (Serial Port Profile)

The standardized Bluetooth Classic serial profile used by the XP-N160II. Kotlin Connector, not Chrome, owns this connection.

## ESC/POS

Byte-command language commonly supported by thermal receipt printers. It controls text, alignment, line feeds, cutting, and other printer operations.

## Transport Adapter

Small Kotlin Connector component that connects, writes serialized raster chunks, and disconnects the XP-N160II SPP socket.

## Encoder

Connector code that turns receipt content into monochrome ESC/POS raster/feed/cut bytes. It does not open the SPP socket by itself.

## Chunk Size

Maximum number of bytes sent in one RFCOMM write. It must be proven against the XP-N160II input buffer.

## Inter-chunk Delay

Pause between byte chunks. Some printers drop data or disconnect when a long receipt is sent faster than their buffer can process it.

## Secure Context

HTTPS page (or localhost during development) required for the selected Web Share handoff.

## User Gesture

Direct user action such as clicking Print. Chrome requires this before opening Android Sharesheet.

## LanFlow Print Connector

First-party Android companion app accepted for LanFlow production devices. Chrome Android hands it an explicit print job; the connector owns XP-N160II Bluetooth Classic pairing/configuration, the SPP connection, serialized writes, and device diagnostics. It does not own or edit Rubber Bill business records.

## Print Job Contract

Versioned boundary between the LanFlow web app and LanFlow Print Connector. Because Android printing must work offline, it is a self-contained receipt snapshot rather than a server job ID. It contains no session or API credential and is validated before rendering.

## Web Share File Handoff

Selected offline handoff in which Chrome creates a small JSON `File` in memory and calls `navigator.share({ files })` from the user's Print action. Android presents compatible targets; the user selects LanFlow Print Connector once per print, and Android sends the file through `ACTION_SEND`. The exact MIME type must pass `navigator.canShare({ files })` on the supported Chrome Android version.

## Sender

The existing Next.js/TypeScript LanFlow web application. It constructs and validates `PrintJobV1`, creates the offline file, and starts the user-initiated Web Share handoff. It does not open an Android RFCOMM socket.

## Receiver

The Kotlin Native LanFlow Print Connector Android application. It receives the shared file, validates and renders the job, owns device-local printer settings, and sends output over Bluetooth Classic SPP. React Native is not part of the selected implementation.

## JSON Schema

Language-neutral contract definition for `PrintJobV1`. The TypeScript sender and Kotlin receiver test against the same checked-in schema and valid/invalid fixture files without sharing a runtime library.

## Preferences DataStore

Android app-private asynchronous key-value storage selected for non-secret Connector settings. It can remember the bonded printer address/name and receipt transport preferences across app restarts; it must not contain pairing PINs, credentials, or receipt/customer payloads.

## Monochrome Raster Receipt

Selected rendering mode for all receipt text. LanFlow lays out Thai, English, and numeric glyphs with a bundled font, then converts them into one-bit black/white raster bands before ESC/POS transmission. External photos, attached images, logos, grayscale, and dithering remain out of scope.

## Native Printer Text

Text encoded into a printer code page and rendered by printer firmware. LanFlow does not use this for the receipt body because Thai support and layout would depend on the XP-N160II firmware/code-page table.

## Return To LanFlow

Simple navigation after Connector writes a job without a reported transport error. Connector opens a fixed, allowlisted LanFlow HTTPS route automatically and exposes a manual `กลับ LanFlow` button. It carries no print result, nonce, or persisted business status.
