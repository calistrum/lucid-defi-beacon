import { blake2b } from "blakejs";

export function calculateFingerprint(policyId: string, assetNameHex: string): string {
  try {
    // Concatenate policy ID and asset name hex
    const assetId = policyId + assetNameHex;

    // Create Blake2b hash with 20 bytes output
    const hashBytes = blake2b(Buffer.from(assetId, "hex"), undefined, 20);

    // Convert hash to Buffer and then to base16 (hex) string
    const hashHex = Buffer.from(hashBytes).toString("hex");

    // Convert the first byte to determine the prefix
    const firstByte = parseInt(hashHex.slice(0, 2), 16);
    const prefix = firstByte < 128 ? "asset1" : "asset";

    // Encode the rest to base32
    const base32Chars = "abcdefghijklmnopqrstuvwxyz234567";
    let result = "";

    // Process 5 bits at a time for base32 encoding
    let bits = 0;
    let value = 0;

    for (let i = 0; i < hashHex.length; i += 2) {
      const byte = parseInt(hashHex.slice(i, i + 2), 16);
      value = (value << 8) | byte;
      bits += 8;

      while (bits >= 5) {
        bits -= 5;
        result += base32Chars[(value >> bits) & 31];
      }
    }

    // Handle remaining bits if any
    if (bits > 0) {
      result += base32Chars[(value << (5 - bits)) & 31];
    }

    return prefix + result;
  } catch (err) {
    console.error("Error calculating fingerprint:", err);
    return "fingerprint-error";
  }
}