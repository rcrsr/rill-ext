# @rcrsr/rill-ext-datetime

[rill](https://rill.run) extension for timezone conversion, date/time formatting, and parsing via the Intl API. Zero external dependencies.

## Install

```bash
npm install @rcrsr/rill-ext-datetime
```

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

$dt.format(now(), "YYYY-MM-DD HH:mm:ss") -> log
$dt.iso(now(), "America/New_York") -> log
```

```bash
rill-run
```

## Documentation

See [full documentation](docs/extension-datetime.md) for configuration, functions, and error handling.

## License

MIT
