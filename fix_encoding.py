"""
PERMANENT ENCODING FIX for Vaanisetu app.js
============================================
Root cause: PowerShell's Add-Content/Set-Content read the UTF-8 file as Windows-1252,
then re-saved it, turning each multi-byte UTF-8 sequence into garbage Unicode codepoints.

Fix strategy:
  1. Read the file as UTF-8 (getting the mojibake)
  2. For each sequence of high-byte chars, try to map them back to bytes
     using the Windows-1252 reverse table, then re-decode as UTF-8
  3. Replace ALL emoji/special chars with HTML entities so PowerShell
     can never corrupt them again (HTML entities are pure ASCII)
"""

# Windows-1252 special chars (0x80-0x9F range) reverse map: Unicode -> byte
W1252_REV = {
    0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84,
    0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88,
    0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C,
    0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93,
    0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
    0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
    0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F,
}

def reverse_mojibake(content):
    """Scan the string and reverse any Windows-1252->UTF-8 corruption."""
    result = []
    i = 0
    fixes = 0
    while i < len(content):
        ch = content[i]
        o = ord(ch)
        if o > 127:
            # Collect a run of high-byte chars, map to bytes via W1252
            seq = []
            j = i
            while j < len(content):
                co = ord(content[j])
                if co <= 127:
                    break
                if co in W1252_REV:
                    seq.append(W1252_REV[co])
                elif co <= 0xFF:
                    seq.append(co)
                else:
                    break  # Genuine Unicode char (already correct)
                j += 1

            if seq and j > i:
                try:
                    decoded = bytes(seq).decode('utf-8')
                    # Only accept if result contains emoji/symbols (> U+00FF)
                    # This prevents false-positive on normal Latin chars
                    if any(ord(c) > 0x00FF for c in decoded):
                        result.append(decoded)
                        fixes += 1
                        i = j
                        continue
                except (UnicodeDecodeError, ValueError):
                    pass

        result.append(ch)
        i += 1

    return ''.join(result), fixes


def emoji_to_entities(content):
    """Replace all non-ASCII chars with HTML entities (pure ASCII output).
    This is the permanent solution — HTML entities work in innerHTML and
    can never be corrupted by PowerShell or any ASCII-unsafe tool."""
    result = []
    replaced = 0
    for ch in content:
        o = ord(ch)
        if o > 127:
            result.append(f'&#{o};')
            replaced += 1
        else:
            result.append(ch)
    return ''.join(result), replaced


if __name__ == '__main__':
    import sys

    files = [
        r'c:\Users\wwwan\Documents\GitHub\Vaanisetu\public\app.js',
        r'c:\Users\wwwan\Documents\GitHub\Vaanisetu\server.js',
    ]

    for path in files:
        print(f'\n=== Processing {path} ===')
        with open(path, 'r', encoding='utf-8') as f:
            original = f.read()

        # Step 1: Reverse all mojibake sequences
        fixed, moji_count = reverse_mojibake(original)
        print(f'  Mojibake sequences reversed: {moji_count}')

        # Step 2: Convert all remaining non-ASCII to HTML entities
        safe, entity_count = emoji_to_entities(fixed)
        print(f'  Non-ASCII chars -> HTML entities: {entity_count}')

        # Step 3: Write back as pure ASCII-safe UTF-8
        with open(path, 'w', encoding='utf-8') as f:
            f.write(safe)

        # Verify
        with open(path, 'r', encoding='utf-8') as f:
            verify = f.read()
        bad = [c for c in verify if ord(c) > 127]
        if bad:
            print(f'  WARNING: {len(bad)} non-ASCII chars remain: {set(bad[:5])}')
        else:
            print(f'  VERIFIED: File is 100% ASCII-safe. No encoding corruption possible.')

    print('\nDone. From now on, any PowerShell write cannot corrupt this file.')
