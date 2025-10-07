#!/usr/bin/env deno run -A --unstable-net

import { parse } from "@std/flags";
import { osc } from "@nuskey8/osc-wasm";

interface Args {
  "osc-host": string;
  "osc-port": number;
  "ws-host": string;
  "ws-port": number;
  verbose: boolean;
  help: boolean;
}

const DEFAULT_CONFIG = {
  oscHost: "127.0.0.1",
  oscPort: 57121,
  wsHost: "localhost",
  wsPort: 8080,
  verbose: false,
};

const HELP_MESSAGE = `
osc2ws - Wraps local OSC output as a WebSocket server

Usage:
  osc2ws [options]

Options:
  --osc-host <host>    Host to receive OSC (default: ${DEFAULT_CONFIG.oscHost})
  --osc-port <port>  Port to receive OSC (default: ${DEFAULT_CONFIG.oscPort})
  --ws-host <host>     WebSocket server host (default: ${DEFAULT_CONFIG.wsHost})
  --ws-port <port>     WebSocket server port (default: ${DEFAULT_CONFIG.wsPort})
  -v, --verbose        Enable detailed logging
  -h, --help           Display this help message
`;

function parseArgs(): Args {
  const args = parse(Deno.args, {
    string: ["osc-host", "ws-host", "osc-port", "ws-port"],
    boolean: ["verbose", "help"],
    alias: {
      v: "verbose",
      h: "help",
    },
    default: {
      "osc-host": DEFAULT_CONFIG.oscHost,
      "osc-port": DEFAULT_CONFIG.oscPort.toString(),
      "ws-host": DEFAULT_CONFIG.wsHost,
      "ws-port": DEFAULT_CONFIG.wsPort.toString(),
      verbose: DEFAULT_CONFIG.verbose,
      help: false,
    },
  });

  const parsedArgs = {
    ...args,
    "osc-port": parseInt(args["osc-port"] as string, 10),
    "ws-port": parseInt(args["ws-port"] as string, 10),
  };

  return parsedArgs as Args;
}

let verboseMode = false;

function log(message: string, type: "info" | "error" | "verbose" = "info") {
  const timestamp = new Date().toISOString();

  switch (type) {
    case "error":
      console.error(`[${timestamp}] ERROR: ${message}`);
      break;
    case "verbose":
      if (verboseMode) {
        console.log(`[${timestamp}] VERBOSE: ${message}`);
      }
      break;
    default:
      console.log(`[${timestamp}] INFO: ${message}`);
  }
}

const wsClients = new Set<WebSocket>();

async function createWebSocketServer(
  host: string,
  port: number,
): Promise<void> {
  const handler = (req: Request): Response => {
    const upgrade = req.headers.get("upgrade");
    if (upgrade?.toLowerCase() !== "websocket") {
      return new Response("400 Bad Request: WebSocket upgrade required", {
        status: 400,
      });
    }

    const { socket, response } = Deno.upgradeWebSocket(req);

    socket.addEventListener("open", () => {
      wsClients.add(socket);
      log(
        `WebSocket client connected (total: ${wsClients.size})`,
        "verbose",
      );
    });

    socket.addEventListener("close", () => {
      wsClients.delete(socket);
      log(
        `WebSocket client disconnected (total: ${wsClients.size})`,
        "verbose",
      );
    });

    socket.addEventListener("error", (error: unknown) => {
      log(`WebSocket error: ${error}`, "error");
      wsClients.delete(socket);
    });

    return response;
  };

  log(`WebSocket server started at ${host}:${port}`);
  await Deno.serve({ hostname: host, port }, handler).finished;
}

function broadcastToWebSocketClients(data: Uint8Array): void {
  if (wsClients.size === 0) {
    log(
      "Received OSC message, but no WebSocket clients are connected",
      "verbose",
    );
    return;
  }

  const deadClients: WebSocket[] = [];

  for (const client of wsClients) {
    try {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      } else {
        deadClients.push(client);
      }
    } catch (error) {
      log(`Error sending to WebSocket client: ${error}`, "error");
      deadClients.push(client);
    }
  }

  deadClients.forEach((client) => wsClients.delete(client));

  if (deadClients.length > 0) {
    log(
      `Removed ${deadClients.length} invalid WebSocket clients`,
      "verbose",
    );
  }

  log(
    `Sent OSC message to ${wsClients.size} WebSocket clients`,
    "verbose",
  );
}

// OSC UDPサーバーの作成
async function createOSCServer(host: string, port: number): Promise<void> {
  const socket = Deno.listenDatagram({
    hostname: host,
    port,
    transport: "udp",
  });

  log(`OSC UDP server started at ${host}:${port}`);

  try {
    for await (const [data, addr] of socket) {
      try {
        const oscMessage = osc.decode(data);

        if (oscMessage) {
          let addrInfo = "unknown";
          if ("hostname" in addr && "port" in addr) {
            addrInfo = `${addr.hostname}:${addr.port}`;
          }

          log(
            `Received OSC message: ${
              JSON.stringify(oscMessage)
            } from ${addrInfo}`,
            "verbose",
          );

          broadcastToWebSocketClients(data);
        } else {
          log("Failed to parse OSC message", "verbose");
        }
      } catch (parseError) {
        log(`OSC message parse error: ${parseError}`, "error");
      }
    }
  } catch (error) {
    log(`OSC server error: ${error}`, "error");
  } finally {
    socket.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    console.log(HELP_MESSAGE);
    Deno.exit(0);
  }

  verboseMode = args.verbose;

  log("Starting OSC WebSocket Proxy...");
  log(
    `Configuration: OSC=${args["osc-host"]}:${args["osc-port"]}, WebSocket=${
      args["ws-host"]
    }:${args["ws-port"]}, Verbose=${args.verbose}`,
  );

  try {
    await Promise.all([
      createWebSocketServer(args["ws-host"], args["ws-port"]),
      createOSCServer(args["osc-host"], args["osc-port"]),
    ]);
  } catch (error) {
    log(`Server startup error: ${error}`, "error");
    Deno.exit(1);
  }
}

function setupGracefulShutdown(): void {
  const shutdown = () => {
    log("Shutting down...");

    for (const client of wsClients) {
      try {
        client.close();
      } catch (_) {
        // ignore errors
      }
    }

    log("Shutdown complete");
    Deno.exit(0);
  };

  Deno.addSignalListener("SIGINT", shutdown);
  Deno.addSignalListener("SIGTERM", shutdown);
}

if (import.meta.main) {
  setupGracefulShutdown();

  try {
    await main();
  } catch (error) {
    log(`Unexpected error: ${error}`, "error");
    Deno.exit(1);
  }
}
