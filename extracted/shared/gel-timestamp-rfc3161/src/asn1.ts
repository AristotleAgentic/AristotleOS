/**
 * Minimal ASN.1 DER encoder + decoder helpers for RFC 3161 TimeStampReq
 * + TimeStampResp wire formats.
 *
 * This is intentionally scope-limited: we only implement what's needed
 * to build a TimeStampReq we can POST and to crack open a TimeStampResp
 * enough to pull out the embedded TimeStampToken (which we store as an
 * opaque blob — full cryptographic verification of the TST is a
 * cert-chain-validation problem operators handle via their own trust
 * store, with `openssl ts -verify` as the standard reference tool).
 *
 * Why hand-rolled rather than a library: the smallest, most-cited
 * Node ASN.1 libraries each ship 50-100 KB of code we don't need, with
 * their own maintenance surface and version-pinning concerns. The 200
 * lines below cover the RFC 3161 request shape exactly and crack open
 * the response just enough.
 */

// ---------------------------------------------------------------------------
// Encoder
// ---------------------------------------------------------------------------

/** DER tag classes. We only use UNIVERSAL + CONTEXT here. */
export const TAG = {
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OBJECT_IDENTIFIER: 0x06,
  SEQUENCE: 0x30,
  SET: 0x31
} as const;

/** Encode a length prefix per DER rules (short form < 128, long form otherwise). */
function derLen(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  let v = n;
  while (v > 0) { bytes.unshift(v & 0xff); v >>>= 8; }
  return Buffer.concat([Buffer.from([0x80 | bytes.length]), Buffer.from(bytes)]);
}

/** Wrap content in a TLV (tag + length + value). */
function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
}

export function encodeInteger(value: number | bigint): Buffer {
  // Two's-complement minimal-length encoding for non-negative integers.
  if (value === 0) return tlv(TAG.INTEGER, Buffer.from([0]));
  const v = typeof value === "bigint" ? value : BigInt(value);
  if (v < 0n) throw new Error("encodeInteger: negative values not supported");
  const bytes: number[] = [];
  let working = v;
  while (working > 0n) { bytes.unshift(Number(working & 0xffn)); working >>= 8n; }
  // If high bit is set, prepend 0x00 to keep it non-negative.
  if (bytes[0] & 0x80) bytes.unshift(0x00);
  return tlv(TAG.INTEGER, Buffer.from(bytes));
}

export function encodeOctetString(bytes: Buffer): Buffer {
  return tlv(TAG.OCTET_STRING, bytes);
}

export function encodeNull(): Buffer {
  return Buffer.from([TAG.NULL, 0]);
}

export function encodeObjectIdentifier(oid: string): Buffer {
  const parts = oid.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length < 2) throw new Error(`encodeObjectIdentifier: ${oid} has fewer than 2 components`);
  const bytes: number[] = [];
  // First two components packed: 40*a + b.
  bytes.push(40 * parts[0] + parts[1]);
  // Remaining components base-128 with continuation bits.
  for (let i = 2; i < parts.length; i++) {
    const comp = parts[i];
    if (comp === 0) { bytes.push(0); continue; }
    const out: number[] = [];
    let v = comp;
    while (v > 0) { out.unshift(v & 0x7f); v >>>= 7; }
    for (let j = 0; j < out.length - 1; j++) out[j] |= 0x80;
    bytes.push(...out);
  }
  return tlv(TAG.OBJECT_IDENTIFIER, Buffer.from(bytes));
}

export function encodeSequence(items: Buffer[]): Buffer {
  return tlv(TAG.SEQUENCE, Buffer.concat(items));
}

// ---------------------------------------------------------------------------
// Decoder (minimal — just walk a TLV stream)
// ---------------------------------------------------------------------------

export interface DerTLV {
  tag: number;
  length: number;
  /** Offset of the value bytes within the input buffer. */
  valueOffset: number;
  /** Length of the entire TLV (tag + length + value) in bytes. */
  totalLength: number;
}

/** Parse one TLV starting at `offset`. Returns the parsed shape. */
export function decodeTLV(buf: Buffer, offset = 0): DerTLV {
  if (offset >= buf.length) throw new Error("decodeTLV: out of bounds");
  const tag = buf[offset];
  let lengthByte = buf[offset + 1];
  let valueLen: number;
  let lengthBytes: number;
  if ((lengthByte & 0x80) === 0) {
    // Short form.
    valueLen = lengthByte;
    lengthBytes = 1;
  } else {
    const nLenBytes = lengthByte & 0x7f;
    valueLen = 0;
    for (let i = 0; i < nLenBytes; i++) valueLen = (valueLen << 8) | buf[offset + 2 + i];
    lengthBytes = 1 + nLenBytes;
  }
  return {
    tag,
    length: valueLen,
    valueOffset: offset + 1 + lengthBytes,
    totalLength: 1 + lengthBytes + valueLen
  };
}

/** Read children of a SEQUENCE / SET. */
export function decodeChildren(buf: Buffer, parent: DerTLV): DerTLV[] {
  const out: DerTLV[] = [];
  let cursor = parent.valueOffset;
  const end = parent.valueOffset + parent.length;
  while (cursor < end) {
    const child = decodeTLV(buf, cursor);
    out.push(child);
    cursor += child.totalLength;
  }
  return out;
}

/** Read the integer payload of an INTEGER TLV as a regular number (asserts it fits). */
export function decodeIntegerSafe(buf: Buffer, tlv: DerTLV): number {
  if (tlv.tag !== TAG.INTEGER) throw new Error(`decodeIntegerSafe: expected INTEGER (0x02), got 0x${tlv.tag.toString(16)}`);
  if (tlv.length > 6) throw new Error(`decodeIntegerSafe: integer of length ${tlv.length} exceeds safe range`);
  let v = 0;
  for (let i = 0; i < tlv.length; i++) v = v * 256 + buf[tlv.valueOffset + i];
  return v;
}
