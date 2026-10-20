/**
 * The course format in the QR links for virtual controls:
 * `https://run.controlfreak.se/#<payload>`.
 *
 * ControlFreak (course setting) writes the link and prints it as a QR code; the runner app
 * on run.controlfreak.se reads it. The course sits after `#`, so it is never sent to a server.
 *
 * The payload is binary, written with only the 43 characters `0-9A-Z$*+-./:`. They are all
 * in the QR code's alphanumeric mode (11 bits per two characters instead of 16) and safe in
 * a URL fragment without escaping. Two bytes become three characters, a last odd byte two,
 * like base45 (RFC 9285) without space and `%`. A QR code for the link is built from two
 * segments: the prefix in byte mode and the payload in alphanumeric mode
 * (see {@link runCourseQrSegments}).
 *
 * The first byte is the format version and is read before anything else, so a later
 * version can be refused without reading the rest. Every later version must read version 1.
 *
 * Byte layout of version 1:
 *
 *     version (1 byte)
 *     flags (1 byte): bit 0 = finish, bit 1 = start, bit 2 = score course
 *     name: length in bytes (varint), UTF-8
 *     [score course: time limit in minutes (varint), penalty per started minute (varint)]
 *     [start: lat delta, lng delta]
 *     number of controls (varint)
 *     per control: code (varint), [score course: points (varint)], lat delta, lng delta
 *     [finish: lat delta, lng delta]
 *
 * Coordinates are integers in 1e-5 degrees (about 1 m). Each position is a zigzag varint
 * delta from the previous one in that order (the first from 0, 0), so a control within a
 * few km of the previous one takes about 5 bytes.
 *
 * The code holds only the course. The punching rules are fixed in the runner app, so the
 * same code is always punched the same way.
 *
 * Compatibility: printed codes live for months. Every release must keep reading every link
 * and payload written since the format of v0.6.0. Earlier pre-release `#c=<base64url>` links
 * are not supported. New data is added only
 * with a new version byte or a new flag, which older readers refuse cleanly; existing bytes
 * are never reinterpreted. The alphabet, the packing, the coordinate resolution and the
 * link prefixes never change. The frozen vectors in `test/run-frozen.test.mjs` pin this.
 */
import { FormatError } from "../errors.js";
/** Origin of the runner app. */
export const RUN_ORIGIN = "https://run.controlfreak.se";
/** Path of the runner app on {@link RUN_ORIGIN}; the course follows after `#`. */
export const RUN_PATH = "/";
/** Everything in a course link before the payload: `https://run.controlfreak.se/#`. */
export const RUN_URL_PREFIX = `${RUN_ORIGIN}${RUN_PATH}#`;
/**
 * The 43 characters a payload is written with, in value order: digits, capital letters,
 * then `$*+-./:`. A subset of the QR alphanumeric mode, safe in a URL fragment.
 */
export const RUN_PAYLOAD_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ$*+-./:";
/** The format version this package writes and the highest it reads. */
export const RUN_FORMAT_VERSION = 1;
const SCALE = 1e5;
/** Guard against garbage that claims to hold millions of controls. */
const MAX_CONTROLS = 1000;
const FLAG_FINISH = 1;
const FLAG_START = 2;
const FLAG_SCORE = 4;
const KNOWN_FLAGS = FLAG_FINISH | FLAG_START | FLAG_SCORE;
const BASE = RUN_PAYLOAD_ALPHABET.length; // 43
const CHAR_VALUE = new Map([...RUN_PAYLOAD_ALPHABET].map((ch, i) => [ch, i]));
const unreadable = () => new FormatError("unreadable");
function toGrid(deg) {
    return Math.round(deg * SCALE);
}
/** A non-negative integer from whatever the caller passed; nonsense becomes 0. */
function count(n) {
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}
class Writer {
    bytes = [];
    byte(b) {
        this.bytes.push(b & 0xff);
    }
    varint(n) {
        let v = count(n);
        while (v >= 0x80) {
            this.bytes.push((v % 0x80) | 0x80);
            v = Math.floor(v / 0x80);
        }
        this.bytes.push(v);
    }
    /** Zigzag, so that small negative numbers are short too. */
    signed(n) {
        this.varint(n < 0 ? -2 * n - 1 : 2 * n);
    }
}
class Reader {
    bytes;
    pos = 0;
    constructor(bytes) {
        this.bytes = bytes;
    }
    byte() {
        if (this.pos >= this.bytes.length)
            throw unreadable();
        return this.bytes[this.pos++] ?? 0;
    }
    varint() {
        let result = 0;
        let factor = 1;
        // At most 7 bytes (49 bits) fit safely in a number; longer is garbage.
        for (let i = 0; i < 7; i++) {
            const b = this.byte();
            result += (b & 0x7f) * factor;
            if (b < 0x80)
                return result;
            factor *= 0x80;
        }
        throw unreadable();
    }
    signed() {
        const z = this.varint();
        return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
    }
    take(n) {
        if (n > this.bytes.length - this.pos)
            throw unreadable();
        const out = this.bytes.subarray(this.pos, this.pos + n);
        this.pos += n;
        return out;
    }
    atEnd() {
        return this.pos === this.bytes.length;
    }
}
/** Bytes to payload characters: two bytes become three characters, a last odd byte two. */
function toPayload(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 2) {
        const hi = bytes[i] ?? 0;
        const lo = bytes[i + 1];
        let n = lo === undefined ? hi : hi * 256 + lo;
        const chars = lo === undefined ? 2 : 3;
        for (let k = 0; k < chars; k++) {
            out += RUN_PAYLOAD_ALPHABET[n % BASE];
            n = Math.floor(n / BASE);
        }
    }
    return out;
}
/** Payload characters back to bytes; anything outside the alphabet or range is unreadable. */
function fromPayload(s) {
    if (s.length % 3 === 1)
        throw unreadable();
    const out = new Uint8Array(Math.floor(s.length / 3) * 2 + (s.length % 3 === 2 ? 1 : 0));
    let o = 0;
    for (let i = 0; i < s.length; i += 3) {
        const group = s.slice(i, i + 3);
        let n = 0;
        for (let k = group.length - 1; k >= 0; k--) {
            const v = CHAR_VALUE.get(group[k] ?? "");
            if (v === undefined)
                throw unreadable();
            n = n * BASE + v;
        }
        if (group.length === 3) {
            if (n > 0xffff)
                throw unreadable();
            out[o++] = n >> 8;
            out[o++] = n & 0xff;
        }
        else {
            if (n > 0xff)
                throw unreadable();
            out[o++] = n;
        }
    }
    return out;
}
/**
 * Writes a course as a payload for the link (without the prefix).
 *
 * Coordinates are rounded to 1e-5 degrees; codes, points and the score rules to
 * non-negative integers.
 *
 * @param course - The course to write.
 * @returns The payload, only characters from {@link RUN_PAYLOAD_ALPHABET}.
 */
export function encodeRunCourse(course) {
    const w = new Writer();
    const score = course.score ?? null;
    w.byte(RUN_FORMAT_VERSION);
    w.byte((course.finish ? FLAG_FINISH : 0) | (course.start ? FLAG_START : 0) | (score ? FLAG_SCORE : 0));
    const name = new TextEncoder().encode(course.name);
    w.varint(name.length);
    for (const b of name)
        w.byte(b);
    if (score) {
        w.varint(score.timeLimitMinutes);
        w.varint(score.penaltyPerMinute);
    }
    let lat = 0;
    let lng = 0;
    const point = (p) => {
        const la = toGrid(p.lat);
        const lo = toGrid(p.lng);
        w.signed(la - lat);
        w.signed(lo - lng);
        lat = la;
        lng = lo;
    };
    if (course.start)
        point(course.start);
    w.varint(course.controls.length);
    for (const control of course.controls) {
        w.varint(control.code);
        if (score)
            w.varint(control.points ?? 0);
        point(control);
    }
    if (course.finish)
        point(course.finish);
    return toPayload(w.bytes);
}
/**
 * Reads a payload written by {@link encodeRunCourse}.
 *
 * @param payload - The payload, without the prefix.
 * @returns The course. Controls have `points` only on a score course.
 * @throws {FormatError} `newer-version` when written by a newer version of the format
 *   (decided by the first byte alone), `unreadable` when cut short or garbage.
 */
export function decodeRunCourse(payload) {
    return readCourse(fromPayload(payload), KNOWN_FLAGS);
}
/**
 * Reads the bytes of a version 1 course.
 */
function readCourse(bytes, knownFlags) {
    const r = new Reader(bytes);
    // The version first: a newer payload must not be interpreted at all.
    const version = r.byte();
    if (version > RUN_FORMAT_VERSION)
        throw new FormatError("newer-version");
    if (version !== RUN_FORMAT_VERSION)
        throw unreadable();
    const flags = r.byte();
    // Unknown flags mean something we do not understand: better an error than a wrong course.
    if (flags & ~knownFlags)
        throw unreadable();
    let name;
    try {
        name = new TextDecoder("utf-8", { fatal: true }).decode(r.take(r.varint()));
    }
    catch (e) {
        if (e instanceof FormatError)
            throw e;
        throw unreadable();
    }
    const score = flags & FLAG_SCORE ? { timeLimitMinutes: r.varint(), penaltyPerMinute: r.varint() } : null;
    let lat = 0;
    let lng = 0;
    const point = () => {
        lat += r.signed();
        lng += r.signed();
        return { lat: lat / SCALE, lng: lng / SCALE };
    };
    const start = flags & FLAG_START ? point() : null;
    const n = r.varint();
    if (n > MAX_CONTROLS)
        throw unreadable();
    const controls = [];
    for (let i = 0; i < n; i++) {
        const code = r.varint();
        if (score) {
            const points = r.varint();
            controls.push({ code, points, ...point() });
        }
        else {
            controls.push({ code, ...point() });
        }
    }
    const finish = flags & FLAG_FINISH ? point() : null;
    if (!r.atEnd())
        throw unreadable();
    return { v: 1, name, start, controls, finish, score };
}
/**
 * The link to a course in the runner app.
 *
 * @param course - The course to link to.
 * @returns `https://run.controlfreak.se/#<payload>`.
 */
export function runCourseUrl(course) {
    return RUN_URL_PREFIX + encodeRunCourse(course);
}
/**
 * The two segments of a QR code for a course link: the prefix as a byte segment and the
 * payload as an alphanumeric segment. With qrcodegen:
 * `QrCode.encodeSegments([QrSegment.makeBytes(utf8(prefix)), QrSegment.makeAlphanumeric(payload)], Ecc.MEDIUM)`.
 * The QR library itself stays in the apps.
 *
 * @param course - The course to encode.
 * @returns The prefix and payload; `prefix + payload` is {@link runCourseUrl}.
 */
export function runCourseQrSegments(course) {
    return { prefix: RUN_URL_PREFIX, payload: encodeRunCourse(course) };
}
/**
 * The course in a `location.hash`: the whole fragment is the payload.
 *
 * @param hash - `location.hash`, with or without the leading `#`.
 * @returns The course, or null when the fragment is empty.
 * @throws {FormatError} As {@link decodeRunCourse} when there is a fragment that is not
 *   a readable course. Older `#c=<base64url>` links are not supported and are `unreadable`.
 */
export function runCourseFromHash(hash) {
    const payload = hash.replace(/^#/, "");
    if (payload === "")
        return null;
    return decodeRunCourse(payload);
}
