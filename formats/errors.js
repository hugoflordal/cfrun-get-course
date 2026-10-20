/**
 * Errors from reading a file, as a code rather than a sentence.
 *
 * The package does not know which language the app shows, so each app turns the code
 * into its own text.
 */
/** Thrown by the readers in this package. Check `code` to tell the cases apart. */
export class FormatError extends Error {
    /** Why the file could not be read. */
    code;
    /** @param code - Why the file could not be read. */
    constructor(code) {
        super(code);
        this.name = "FormatError";
        this.code = code;
    }
}
