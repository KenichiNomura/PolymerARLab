export function isIOSDevice(): boolean {
  // iPadOS reports itself as MacIntel; the touch-point check catches it.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
