import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/*
 * Every tool states all three hints explicitly (readOnlyHint, destructiveHint, openWorldHint):
 * clients use them to decide what to run freely and what to confirm with the user first.
 * None of the tools reaches beyond the user's own ATimeLogger data or the app's docs, so
 * openWorldHint is false throughout.
 */

/** Reads the user's data (or the app docs) and changes nothing. */
export const READS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Adds to the time log or moves a timer along; never overwrites what the user had. */
export const ADDS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

/**
 * Switches a state the user can switch back (archiving a type); setting it twice changes nothing.
 * Still destructive: archiving takes a type out of use, and being able to undo it is no reason to
 * say otherwise.
 */
export const TOGGLES: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

/** Replaces something the user wrote (a comment, a tag list, an entry's times). */
export const REPLACES: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};
