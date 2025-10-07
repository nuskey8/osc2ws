# osc2ws

osc2ws is a CLI tool for wrapping OSC input as a WebSocket server. Since browsers don't have a way to get OSC input directly, it does this via WebSocket.

## Install

To use osc2ws, you need to install Deno.

```
$ deno install -g --unstable-net -A jsr:@nuskey8/osc2ws
```

## Usage

```
$ osc2ws -h

osc2ws - Wraps local OSC output as a WebSocket server

Usage:
  osc2ws [options]

Options:
  --osc-host <host>    Host to receive OSC (default: 127.0.0.1)
  --osc-port <port>  Port to receive OSC (default: 57121)
  --ws-host <host>     WebSocket server host (default: localhost)
  --ws-port <port>     WebSocket server port (default: 8080)
  -v, --verbose        Enable detailed logging
  -h, --help           Display this help message
```

## License

This repository is under the [MIT License](LICENSE).