import QRCode from "qrcode";

/**
 * Encode a string as a QR code rendered with Unicode block characters.
 * Returns an array of text lines suitable for terminal display.
 */
export async function encodeQR(data: string): Promise<string[]> {
  const text = await QRCode.toString(data, {
    type: "utf8",
    errorCorrectionLevel: "L",
  });
  return text.split("\n");
}
