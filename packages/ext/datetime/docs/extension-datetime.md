# datetime Extension

*Timezone conversion, date/time formatting, and parsing via the Intl API*

## Quick Start

**rill-config.json**

```json
{
  "main": "app.rill",
  "extensions": {
    "mounts": {
      "dt": "@rcrsr/rill-ext-datetime"
    }
  }
}
```

**app.rill**

```rill
use<ext:dt> => $dt

// Format a datetime
$dt.format(now(), "YYYY-MM-DD HH:mm:ss") -> log

// Convert to a timezone
$dt.iso(now(), "America/New_York") -> log

// Parse a date string
$dt.parse("2026-04-04", "YYYY-MM-DD") -> log
```

## Configuration

No configuration required. The extension uses the system Intl API.

## Functions

### iso

Convert UTC datetime to offset ISO 8601 string in a named timezone.

```rill
$dt.iso(now(), "America/New_York") -> log
// "2026-04-04T12:30:00-04:00"
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `dt` | datetime | — | UTC datetime value |
| `zone` | string | — | IANA timezone name |

**Returns:** string (ISO 8601 with offset, e.g. `2026-04-04T12:30:00-04:00`)

### date

Convert UTC datetime to YYYY-MM-DD string in a named timezone.

```rill
$dt.date(now(), "Europe/London") -> log
// "2026-04-04"
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `dt` | datetime | — | UTC datetime value |
| `zone` | string | — | IANA timezone name |

**Returns:** string (`YYYY-MM-DD`)

### time

Convert UTC datetime to HH:mm:ss string in a named timezone.

```rill
$dt.time(now(), "Asia/Tokyo") -> log
// "21:30:00"
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `dt` | datetime | — | UTC datetime value |
| `zone` | string | — | IANA timezone name |

**Returns:** string (`HH:mm:ss`)

### offset

Get UTC offset in decimal hours for a named timezone.

```rill
$dt.offset("America/Chicago") -> log
// -5
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `zone` | string | — | IANA timezone name |
| `dt` | datetime | now | Instant for offset lookup; defaults to current time |

**Returns:** number (decimal hours, e.g. `-5`, `5.75`)

### zones

List all valid IANA timezone names supported by the runtime.

```rill
$dt.zones() -> log
```

**Returns:** list of strings

### format

Format a UTC datetime using pattern tokens.

```rill
$dt.format(now(), "YYYY-MM-DD") -> log
$dt.format(now(), "HH:mm:ss.SSS") -> log
$dt.format(now(), "YYYY/MM/DD HH:mm") -> log
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `dt` | datetime | — | UTC datetime value |
| `pattern` | string | — | Format pattern using tokens below |

**Returns:** string

### parse

Parse a date string using a pattern and return a UTC datetime.

```rill
$dt.parse("2026-04-04", "YYYY-MM-DD") -> log
$dt.parse("2026-04-04 14:30:00", "YYYY-MM-DD HH:mm:ss") -> log
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `str` | string | — | Input date string |
| `pattern` | string | — | Parse pattern using tokens below |

**Returns:** datetime (epoch milliseconds, UTC)

## Format Tokens

| Token | Output | Example |
|-------|--------|---------|
| `YYYY` | 4-digit year | `2026` |
| `MM` | 2-digit month | `04` |
| `DD` | 2-digit day | `04` |
| `HH` | 2-digit hour (24h) | `14` |
| `mm` | 2-digit minute | `30` |
| `ss` | 2-digit second | `00` |
| `SSS` | 3-digit millisecond | `123` |

Non-token characters (hyphens, colons, spaces, slashes) pass through as literals.

## Errors

The extension emits failures as invalid `RillValue`s carrying rill core's
generic atoms. Host scripts match coarsely (`guard #INVALID_INPUT`) or finely
(`guard #INVALID_INPUT && raw.kind == 'unknown_timezone'`).

**Host-fn errors:**

| Failure | Atom | `meta.raw.kind` |
|---|---|---|
| Zone name not in `Intl.supportedValuesOf('timeZone')` | `#INVALID_INPUT` | `unknown_timezone` |
| Pattern contains unrecognized format token | `#INVALID_INPUT` | `unknown_format_token` |
| Input string does not match the given pattern | `#INVALID_INPUT` | `parse_mismatch` |
| Argument type does not match expected type | `#INVALID_INPUT` | `type_mismatch` |
| Extension disposed while operation in progress | `#DISPOSED` | `disposed` |
