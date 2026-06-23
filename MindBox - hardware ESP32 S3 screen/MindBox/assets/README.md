# assets/

Binary UI assets for the S3 sketch. Not compiled by the Arduino build (only
`src/` is), so anything here must be referenced from code as a generated header.

Planned:
- **`inter_*.h`** — anti-aliased Inter VLW/GFX font headers for the hero timer
  numerals (the exact thin Tomato32 look). Until added, `TimerScreen` uses the
  bundled `FreeSans` family; swapping is a one-line `setFont()` change.
- background images, if custom backdrops are added later.
