// Hebrew → Latin transliteration for device labels.
//
// The MindBox screen fonts are ASCII-only (FreeMono 0x20–0x7E), so Hebrew
// titles render as blanks. Rather than ship a Hebrew font + RTL layout to the
// firmware, we romanize titles server-side before they enter the flat device
// strings (agenda/week/homework/exam titles, owner name, command text). Lossy
// but readable — "מבחן" -> "mbchn", "אלגברה" -> "algbrh".
//
// Scheme: a pragmatic consonantal map (Hebrew is written without vowels), with
// א/ע→a, ו→o, י→i giving enough vowels to stay recognizable. Final forms map
// to their base sound. Niqqud, cantillation, geresh/gershayim and other
// Hebrew-block marks have no Latin form and are dropped. Non-Hebrew text
// (Latin, digits, spaces, punctuation) passes through unchanged.

const HEBREW_LETTERS: Record<string, string> = {
  א: "a",
  ב: "b",
  ג: "g",
  ד: "d",
  ה: "h",
  ו: "o",
  ז: "z",
  ח: "ch",
  ט: "t",
  י: "i",
  כ: "k",
  ך: "k",
  ל: "l",
  מ: "m",
  ם: "m",
  נ: "n",
  ן: "n",
  ס: "s",
  ע: "a",
  פ: "p",
  ף: "f",
  צ: "tz",
  ץ: "tz",
  ק: "k",
  ר: "r",
  ש: "sh",
  ת: "t",
};

/** Latinize any Hebrew in `text`; leave everything else untouched. */
export function transliterateHebrew(text: string): string {
  let out = "";
  for (const ch of text) {
    const mapped = HEBREW_LETTERS[ch];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    const code = ch.codePointAt(0) ?? 0;
    // Other chars in the Hebrew block (U+0590–U+05FF: niqqud, cantillation,
    // geresh/gershayim, Hebrew punctuation) have no Latin form — drop them.
    if (code >= 0x0590 && code <= 0x05ff) continue;
    out += ch;
  }
  return out;
}

/** True if the string contains any Hebrew-block character. */
export function hasHebrew(text: string): boolean {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x0590 && code <= 0x05ff) return true;
  }
  return false;
}
