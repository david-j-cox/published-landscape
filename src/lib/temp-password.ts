import "server-only";
import { randomInt } from "node:crypto";

// No 0/O, 1/l/I - these get read aloud, retyped from a phone screen, and
// pasted out of email clients that helpfully capitalise the first letter.
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const GROUPS = 3;
const GROUP_LENGTH = 4;

/**
 * A one-use password mailed to someone who has no account yet. Hyphenated
 * into groups because people do retype these by hand.
 *
 * 31^12 combinations is about 59 bits, which is far more than the thing needs
 * to survive: it only has to hold until first sign-in, at which point
 * profiles.must_set_password forces it to be replaced.
 */
export function generateTempPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let group = "";
    // randomInt is rejection-sampled, so this stays uniform over an alphabet
    // whose length isn't a power of two.
    for (let i = 0; i < GROUP_LENGTH; i++) group += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(group);
  }
  return groups.join("-");
}
