// Status message channels. Each on-screen area has one owner:
// - the Status panel (general app events, warnings),
// - the scan strip (capture/recognition progress; mirrored to the panel
//   because both surfaces are visible in different layouts),
// - the platform line (persistent platform/build info, set at boot),
// - the import line (import pipeline results).

const platformEl = document.getElementById("platformStatus")!;
const generalEl = document.getElementById("mobileStatus")!;
const scanEl = document.getElementById("scanStatus")!;
const importEl = document.getElementById("importStatus")!;

export function showStatus(message: string, warn = false) {
  generalEl.textContent = message;
  generalEl.classList.toggle("is-warning", warn);
}

export function showScanStatus(message: string, warn = false) {
  scanEl.textContent = message;
  showStatus(message, warn);
}

export function showPlatformStatus(message: string) {
  platformEl.textContent = message;
}

export function showImportStatus(message: string) {
  importEl.textContent = message;
}
